import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import {
	ensureSchemaAsync,
	getTableColumnsAsync,
	runMigrationsAsync,
} from "../async-migrations";
import { PostgresAdapter } from "../postgres-adapter";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL as string;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

const ALL_TABLES = [
	"request_payloads",
	"requests",
	"accounts",
	"oauth_sessions",
	"agent_preferences",
	"api_keys",
	"model_translations",
];

describePostgres("Async Migrations Integration (PostgreSQL)", () => {
	let adapter: PostgresAdapter;

	beforeAll(() => {
		adapter = new PostgresAdapter(TEST_DATABASE_URL);
	});

	beforeEach(async () => {
		for (const table of ALL_TABLES) {
			await adapter.exec(`DROP TABLE IF EXISTS ${table} CASCADE`);
		}
	});

	afterAll(async () => {
		for (const table of ALL_TABLES) {
			await adapter.exec(`DROP TABLE IF EXISTS ${table} CASCADE`);
		}
		await adapter.close();
	});

	it("ensureSchemaAsync creates all tables", async () => {
		await ensureSchemaAsync(adapter);

		const rows = await adapter.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
		);
		const tableNames = rows.map((r) => r.table_name);

		for (const table of ALL_TABLES) {
			expect(tableNames).toContain(table);
		}
	});

	it("ensureSchemaAsync creates base indexes", async () => {
		await ensureSchemaAsync(adapter);

		const rows = await adapter.query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
		);
		const indexNames = rows.map((r) => r.indexname);

		const expectedIndexes = [
			"idx_requests_timestamp",
			"idx_api_keys_hashed_key",
			"idx_oauth_sessions_expires",
			"idx_model_translations_client_name",
			"idx_model_translations_unique",
		];

		for (const idx of expectedIndexes) {
			expect(indexNames).toContain(idx);
		}
	});

	it("ensureSchemaAsync is idempotent", async () => {
		await ensureSchemaAsync(adapter);
		await ensureSchemaAsync(adapter);

		const rows = await adapter.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
		);
		const tableNames = rows.map((r) => r.table_name);

		for (const table of ALL_TABLES) {
			expect(tableNames).toContain(table);
		}

		const indexes = await adapter.query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
		);
		const indexNames = indexes.map((r) => r.indexname);

		expect(indexNames).toContain("idx_requests_timestamp");
		expect(indexNames).toContain("idx_model_translations_unique");
	});

	it("runMigrationsAsync creates all expected columns", async () => {
		await runMigrationsAsync(adapter);

		const accountsCols = await getTableColumnsAsync(adapter, "accounts");
		const expectedAccountsCols = [
			"id",
			"name",
			"provider",
			"api_key",
			"refresh_token",
			"access_token",
			"expires_at",
			"created_at",
			"last_used",
			"request_count",
			"total_requests",
			"priority",
			"rate_limited_until",
			"session_start",
			"session_request_count",
			"paused",
			"rate_limit_reset",
			"rate_limit_status",
			"rate_limit_remaining",
			"auto_fallback_enabled",
			"custom_endpoint",
			"auto_refresh_enabled",
			"model_mappings",
			"cross_region_mode",
		];
		for (const col of expectedAccountsCols) {
			expect(accountsCols).toContain(col);
		}

		const requestsCols = await getTableColumnsAsync(adapter, "requests");
		expect(requestsCols).toContain("model");
		expect(requestsCols).toContain("api_key_id");
		expect(requestsCols).toContain("api_key_name");
		expect(requestsCols).toContain("output_tokens_per_second");

		const oauthCols = await getTableColumnsAsync(adapter, "oauth_sessions");
		expect(oauthCols).toContain("custom_endpoint");

		const apiKeysCols = await getTableColumnsAsync(adapter, "api_keys");
		expect(apiKeysCols).toContain("role");
	});

	it("runMigrationsAsync is idempotent", async () => {
		await runMigrationsAsync(adapter);
		await runMigrationsAsync(adapter);

		const accountsCols = await getTableColumnsAsync(adapter, "accounts");
		expect(accountsCols).toContain("id");
		expect(accountsCols).toContain("cross_region_mode");
	});

	it("runMigrationsAsync creates performance indexes", async () => {
		await runMigrationsAsync(adapter);

		const rows = await adapter.query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
		);
		const indexNames = rows.map((r) => r.indexname);

		const expectedIndexes = [
			"idx_requests_model_timestamp",
			"idx_accounts_paused",
			"idx_accounts_name",
			"idx_accounts_rate_limited",
		];

		for (const idx of expectedIndexes) {
			expect(indexNames).toContain(idx);
		}
	});

	it("runMigrationsAsync populates default model translations", async () => {
		await runMigrationsAsync(adapter);

		const rows = await adapter.query<{
			client_name: string;
			bedrock_model_id: string;
		}>("SELECT client_name, bedrock_model_id FROM model_translations");

		expect(rows.length).toBe(11);

		const specific = rows.find(
			(r) => r.client_name === "claude-3-5-sonnet-20241022",
		);
		expect(specific).not.toBeNull();
		expect(specific?.bedrock_model_id).toBe(
			"us.anthropic.claude-3-5-sonnet-20241022-v2:0",
		);
	});

	it("runMigrationsAsync handles tier column removal", async () => {
		await ensureSchemaAsync(adapter);
		await adapter.exec(
			"ALTER TABLE accounts ADD COLUMN account_tier TEXT DEFAULT 'free'",
		);

		const colsBefore = await getTableColumnsAsync(adapter, "accounts");
		expect(colsBefore).toContain("account_tier");

		await runMigrationsAsync(adapter);

		const colsAfter = await getTableColumnsAsync(adapter, "accounts");
		expect(colsAfter).not.toContain("account_tier");
	});
});

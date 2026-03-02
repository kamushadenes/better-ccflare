import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncSqliteAdapter } from "../async-sqlite-adapter";
import { migrateToPostgres } from "../migrate-to-postgres";
import { ensureSchema, runMigrations } from "../migrations";
import { SqliteAdapter } from "../sqlite-adapter";

describe("migrateToPostgres", () => {
	let sourceDir: string;
	let targetDir: string;
	let sourceAdapter: SqliteAdapter;
	let targetSyncAdapter: SqliteAdapter;
	let targetAdapter: AsyncSqliteAdapter;

	beforeEach(() => {
		sourceDir = mkdtempSync(join(tmpdir(), "migrate-src-"));
		targetDir = mkdtempSync(join(tmpdir(), "migrate-tgt-"));
		sourceAdapter = new SqliteAdapter(join(sourceDir, "source.db"), {
			create: true,
		});
		const rawSourceDb = sourceAdapter.getRawDatabase();
		ensureSchema(rawSourceDb);
		runMigrations(rawSourceDb, join(sourceDir, "source.db"));

		targetSyncAdapter = new SqliteAdapter(join(targetDir, "target.db"), {
			create: true,
		});
		const rawTargetDb = targetSyncAdapter.getRawDatabase();
		ensureSchema(rawTargetDb);
		runMigrations(rawTargetDb, join(targetDir, "target.db"));
		targetAdapter = new AsyncSqliteAdapter(targetSyncAdapter);
	});

	afterEach(() => {
		try {
			sourceAdapter.close();
		} catch {}
		try {
			targetSyncAdapter.close();
		} catch {}
		rmSync(sourceDir, { recursive: true, force: true });
		rmSync(targetDir, { recursive: true, force: true });
	});

	test("returns zero counts for all tables when source is empty", async () => {
		// Create a separate source with only schema (no seed data from runMigrations)
		const emptyDir = mkdtempSync(join(tmpdir(), "migrate-empty-"));
		const emptyPath = join(emptyDir, "empty.db");
		const emptyAdapter = new SqliteAdapter(emptyPath, { create: true });
		ensureSchema(emptyAdapter.getRawDatabase());
		emptyAdapter.close();

		const result = await migrateToPostgres(emptyPath, targetAdapter);

		expect(result.totalRows).toBe(0);
		expect(result.tables.length).toBeGreaterThan(0);
		for (const table of result.tables) {
			if (!table.skipped) {
				expect(table.rowsMigrated).toBe(0);
			}
		}
		expect(result.durationMs).toBeGreaterThanOrEqual(0);

		rmSync(emptyDir, { recursive: true, force: true });
	});

	test("migrates populated accounts to target", async () => {
		// Insert test accounts into source
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-1", "test-account", "claude-oauth", "token-1", Date.now(), 0],
		);
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-2", "second-account", "console", "token-2", Date.now(), 1],
		);
		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		const result = await migrateToPostgres(sourcePath, targetAdapter);

		const accountsResult = result.tables.find((t) => t.table === "accounts");
		expect(accountsResult).toBeDefined();
		expect(accountsResult?.rowsMigrated).toBe(2);

		// Verify target has the rows
		const targetRows = await targetAdapter.query<{ id: string; name: string }>(
			"SELECT id, name FROM accounts ORDER BY id",
		);
		expect(targetRows).toHaveLength(2);
		expect(targetRows[0].id).toBe("acc-1");
		expect(targetRows[1].id).toBe("acc-2");
	});

	test("migrates all 8 tables with correct counts", async () => {
		const now = Date.now();

		// accounts (2 rows)
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-1", "acct1", "claude-oauth", "tok1", now, 0],
		);
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-2", "acct2", "console", "tok2", now, 1],
		);

		// requests (1 row)
		sourceAdapter.run(
			"INSERT INTO requests (id, timestamp, method, path) VALUES ($1, $2, $3, $4)",
			["req-1", now, "POST", "/v1/messages"],
		);

		// request_payloads (1 row)
		sourceAdapter.run(
			"INSERT INTO request_payloads (id, json) VALUES ($1, $2)",
			["req-1", '{"test": true}'],
		);

		// oauth_sessions (1 row)
		sourceAdapter.run(
			"INSERT INTO oauth_sessions (id, account_name, verifier, mode, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
			["sess-1", "acct1", "verifier-1", "claude-oauth", now, now + 3600000],
		);

		// agent_preferences (1 row)
		sourceAdapter.run(
			"INSERT INTO agent_preferences (agent_id, model, updated_at) VALUES ($1, $2, $3)",
			["agent-1", "claude-sonnet-4-20250514", now],
		);

		// api_keys (1 row)
		sourceAdapter.run(
			"INSERT INTO api_keys (id, name, hashed_key, prefix_last_8, created_at, role) VALUES ($1, $2, $3, $4, $5, $6)",
			["key-1", "test-key", "hashed123", "...abc12", now, "admin"],
		);

		// model_translations already has 11 from runMigrations

		// strategies table doesn't exist in source by default -> skipped

		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		const result = await migrateToPostgres(sourcePath, targetAdapter);

		expect(
			result.tables.find((t) => t.table === "accounts")?.rowsMigrated,
		).toBe(2);
		expect(
			result.tables.find((t) => t.table === "requests")?.rowsMigrated,
		).toBe(1);
		expect(
			result.tables.find((t) => t.table === "request_payloads")?.rowsMigrated,
		).toBe(1);
		expect(
			result.tables.find((t) => t.table === "oauth_sessions")?.rowsMigrated,
		).toBe(1);
		expect(
			result.tables.find((t) => t.table === "agent_preferences")?.rowsMigrated,
		).toBe(1);
		expect(
			result.tables.find((t) => t.table === "api_keys")?.rowsMigrated,
		).toBe(1);
		expect(
			result.tables.find((t) => t.table === "model_translations")?.rowsMigrated,
		).toBe(11);
		expect(result.tables.find((t) => t.table === "strategies")?.skipped).toBe(
			true,
		);

		expect(result.totalRows).toBe(2 + 1 + 1 + 1 + 1 + 1 + 11); // 18
	});

	test("is idempotent -- running twice produces no duplicate rows", async () => {
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-1", "acct1", "claude-oauth", "tok1", Date.now(), 0],
		);
		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		// Run migration twice
		await migrateToPostgres(sourcePath, targetAdapter);
		const result2 = await migrateToPostgres(sourcePath, targetAdapter);

		// Second run should still report the row count from source
		expect(
			result2.tables.find((t) => t.table === "accounts")?.rowsMigrated,
		).toBe(1);

		// But target should have only 1 row (not 2 duplicates)
		const targetRows = await targetAdapter.query<{ id: string }>(
			"SELECT id FROM accounts",
		);
		expect(targetRows).toHaveLength(1);
	});

	test("skips missing strategies table gracefully", async () => {
		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		const result = await migrateToPostgres(sourcePath, targetAdapter);

		const strategiesResult = result.tables.find(
			(t) => t.table === "strategies",
		);
		expect(strategiesResult).toBeDefined();
		expect(strategiesResult?.skipped).toBe(true);
		expect(strategiesResult?.rowsMigrated).toBe(0);
	});

	test("respects FK order -- request_payloads inserted after requests", async () => {
		const now = Date.now();
		sourceAdapter.run(
			"INSERT INTO requests (id, timestamp, method, path) VALUES ($1, $2, $3, $4)",
			["req-1", now, "POST", "/v1/messages"],
		);
		sourceAdapter.run(
			"INSERT INTO request_payloads (id, json) VALUES ($1, $2)",
			["req-1", '{"body":"hello"}'],
		);
		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		const result = await migrateToPostgres(sourcePath, targetAdapter);

		// Verify ordering: requests comes before request_payloads in the result
		const requestsIdx = result.tables.findIndex((t) => t.table === "requests");
		const payloadsIdx = result.tables.findIndex(
			(t) => t.table === "request_payloads",
		);
		expect(requestsIdx).toBeLessThan(payloadsIdx);

		// Verify data was actually migrated
		const payloadRows = await targetAdapter.query<{ id: string }>(
			"SELECT id FROM request_payloads",
		);
		expect(payloadRows).toHaveLength(1);
		expect(payloadRows[0].id).toBe("req-1");
	});

	test("reports per-table stats in MigrationResult", async () => {
		const now = Date.now();
		sourceAdapter.run(
			"INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority) VALUES ($1, $2, $3, $4, $5, $6)",
			["acc-1", "acct1", "claude-oauth", "tok1", now, 0],
		);
		const sourcePath = join(sourceDir, "source.db");
		sourceAdapter.close();

		const result = await migrateToPostgres(sourcePath, targetAdapter);

		// Should have an entry for each table in TABLE_ORDER
		expect(result.tables).toHaveLength(8);

		// Each entry has table, rowsMigrated, skipped
		for (const tableResult of result.tables) {
			expect(typeof tableResult.table).toBe("string");
			expect(typeof tableResult.rowsMigrated).toBe("number");
			expect(typeof tableResult.skipped).toBe("boolean");
		}

		// totalRows equals sum of rowsMigrated
		const sum = result.tables.reduce((s, t) => s + t.rowsMigrated, 0);
		expect(result.totalRows).toBe(sum);

		// durationMs is a reasonable number
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.durationMs).toBeLessThan(10000);
	});

	test("CLI --help includes --migrate-to-postgres flag", async () => {
		// Test that the CLI recognizes the migration flags by running it with --help
		const proc = Bun.spawn(["bun", "run", "apps/cli/src/main.ts", "--help"], {
			cwd: join(__dirname, "../../../.."),
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		expect(stdout).toContain("--migrate-to-postgres");
		expect(stdout).toContain("--sqlite-path");
	});
});

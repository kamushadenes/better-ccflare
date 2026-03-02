import { Logger } from "@better-ccflare/logger";
import type { AsyncDatabaseAdapter } from "./adapter";
import { addPerformanceIndexesAsync } from "./async-performance-indexes";

const log = new Logger("DatabaseMigrations");

export async function getTableColumnsAsync(
	adapter: AsyncDatabaseAdapter,
	table: string,
): Promise<string[]> {
	const rows = await adapter.query<{ column_name: string }>(
		"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
		[table],
	);
	return rows.map((row) => row.column_name);
}

export async function ensureSchemaAsync(
	adapter: AsyncDatabaseAdapter,
): Promise<void> {
	// Create accounts table
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS accounts (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			provider TEXT DEFAULT 'anthropic',
			api_key TEXT,
			refresh_token TEXT NOT NULL,
			access_token TEXT,
			expires_at BIGINT,
			created_at BIGINT NOT NULL,
			last_used BIGINT,
			request_count INTEGER DEFAULT 0,
			total_requests INTEGER DEFAULT 0,
			priority INTEGER DEFAULT 0
		)
	`);

	// Create requests table
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS requests (
			id TEXT PRIMARY KEY,
			timestamp BIGINT NOT NULL,
			method TEXT NOT NULL,
			path TEXT NOT NULL,
			account_used TEXT,
			status_code INTEGER,
			success BOOLEAN,
			error_message TEXT,
			response_time_ms INTEGER,
			failover_attempts INTEGER DEFAULT 0,
			model TEXT,
			prompt_tokens INTEGER DEFAULT 0,
			completion_tokens INTEGER DEFAULT 0,
			total_tokens INTEGER DEFAULT 0,
			cost_usd REAL DEFAULT 0,
			output_tokens_per_second REAL,
			input_tokens INTEGER DEFAULT 0,
			cache_read_input_tokens INTEGER DEFAULT 0,
			cache_creation_input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0,
			agent_used TEXT
		)
	`);

	// Create indexes for faster queries
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC)`,
	);

	// Index for JOIN performance with accounts table
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_requests_account_used ON requests(account_used)`,
	);

	// Composite index for the main requests query (timestamp DESC with account_used for JOIN)
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_requests_timestamp_account ON requests(timestamp DESC, account_used)`,
	);

	// Create request_payloads table for storing full request/response data
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS request_payloads (
			id TEXT PRIMARY KEY,
			json TEXT NOT NULL,
			FOREIGN KEY (id) REFERENCES requests(id) ON DELETE CASCADE
		)
	`);

	// Create oauth_sessions table for secure PKCE verifier storage
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS oauth_sessions (
			id TEXT PRIMARY KEY,
			account_name TEXT NOT NULL,
			verifier TEXT NOT NULL,
			mode TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			expires_at BIGINT NOT NULL
		)
	`);

	// Create index for faster cleanup of expired sessions
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at)`,
	);

	// Create agent_preferences table for storing user-defined agent settings
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS agent_preferences (
			agent_id TEXT PRIMARY KEY,
			model TEXT NOT NULL,
			updated_at BIGINT NOT NULL
		)
	`);

	// Create api_keys table for optional API authentication
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			hashed_key TEXT NOT NULL UNIQUE,
			prefix_last_8 TEXT NOT NULL,
			created_at BIGINT NOT NULL,
			last_used BIGINT,
			usage_count INTEGER DEFAULT 0,
			is_active INTEGER DEFAULT 1
		)
	`);

	// Create index for faster API key lookups
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_key ON api_keys(hashed_key)`,
	);

	// Create index for active API keys
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active)`,
	);

	// Create model_translations table for mapping client model names to Bedrock model IDs
	await adapter.exec(`
		CREATE TABLE IF NOT EXISTS model_translations (
			id TEXT PRIMARY KEY,
			client_name TEXT NOT NULL,
			bedrock_model_id TEXT NOT NULL,
			is_default INTEGER DEFAULT 1,
			auto_discovered INTEGER DEFAULT 0,
			created_at BIGINT NOT NULL,
			updated_at BIGINT NOT NULL
		)
	`);

	// Create index for fast lookups by client name
	await adapter.exec(
		`CREATE INDEX IF NOT EXISTS idx_model_translations_client_name ON model_translations(client_name)`,
	);

	// Create unique index to prevent duplicate mappings
	await adapter.exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_model_translations_unique ON model_translations(client_name, bedrock_model_id)`,
	);
}

async function runApiKeyStorageMigrationAsync(
	adapter: AsyncDatabaseAdapter,
): Promise<void> {
	try {
		// Update API-key providers to move API key from refresh_token to api_key field
		const result = await adapter.run(`
			UPDATE accounts
			SET
				api_key = refresh_token,
				refresh_token = '',
				access_token = '',
				expires_at = NULL
			WHERE
				provider IN ('zai', 'openai-compatible', 'minimax', 'anthropic-compatible')
				AND api_key IS NULL
				AND refresh_token IS NOT NULL
				AND refresh_token != ''
				AND LENGTH(refresh_token) > 0
		`);
		const updatedCount = result.changes || 0;
		log.debug(
			`API Key Migration: Updated ${updatedCount} API-key provider accounts from refresh_token to api_key field`,
		);

		// Also handle accounts where both api_key and refresh_token have the same value (duplicate storage)
		const cleanupResult = await adapter.run(`
			UPDATE accounts
			SET
				refresh_token = '',
				access_token = '',
				expires_at = NULL
			WHERE
				provider IN ('zai', 'openai-compatible', 'minimax', 'anthropic-compatible')
				AND api_key IS NOT NULL
				AND refresh_token = api_key
		`);
		const cleanupCount = cleanupResult.changes || 0;

		// Handle console accounts separately
		const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
		const consoleResult = await adapter.run(
			`
			UPDATE accounts
			SET
				api_key = refresh_token,
				refresh_token = '',
				access_token = '',
				expires_at = NULL
			WHERE
				provider = 'anthropic'
				AND api_key IS NULL
				AND refresh_token IS NOT NULL
				AND refresh_token != ''
				AND access_token IS NULL
				AND (
					expires_at IS NULL
					OR expires_at = 0
					OR expires_at < ?
				)
				AND refresh_token NOT LIKE 'sk-ant-api03-%'
				AND refresh_token NOT LIKE 'sk-ant-%'
		`,
			[cutoffTime],
		);
		const consoleCount = consoleResult.changes || 0;

		const totalCount = updatedCount + cleanupCount + consoleCount;
		if (totalCount > 0) {
			log.info(
				`Migrated ${totalCount} accounts to API key storage v2 (moved from refresh_token to api_key)`,
				{
					migrationVersion: 2,
					timestamp: new Date().toISOString(),
					updatedAccounts: updatedCount,
					cleanupAccounts: cleanupCount,
					consoleAccounts: consoleCount,
				},
			);
			if (updatedCount > 0) {
				log.debug(
					`  - ${updatedCount} accounts had API key moved from refresh_token to api_key`,
				);
			}
			if (cleanupCount > 0) {
				log.debug(
					`  - ${cleanupCount} accounts had duplicate API key storage cleaned up`,
				);
			}
			if (consoleCount > 0) {
				log.debug(
					`  - ${consoleCount} console accounts had API key moved from refresh_token to api_key (using enhanced detection)`,
				);
			}
		}
	} catch (error) {
		log.warn(
			`Error during API key storage migration: ${(error as Error).message}`,
		);
	}
}

export async function runMigrationsAsync(
	adapter: AsyncDatabaseAdapter,
): Promise<void> {
	// Ensure base schema exists first (outside transaction as it creates tables)
	await ensureSchemaAsync(adapter);

	// Migrate INTEGER timestamp columns to BIGINT (fixes overflow for ms timestamps on PostgreSQL)
	if (adapter.dialect === "postgres") {
		const timestampColumns = [
			["accounts", "expires_at"],
			["accounts", "created_at"],
			["accounts", "last_used"],
			["accounts", "rate_limited_until"],
			["accounts", "session_start"],
			["accounts", "rate_limit_reset"],
			["requests", "timestamp"],
			["oauth_sessions", "created_at"],
			["oauth_sessions", "expires_at"],
			["agent_preferences", "updated_at"],
			["api_keys", "created_at"],
			["api_keys", "last_used"],
			["model_translations", "created_at"],
			["model_translations", "updated_at"],
		];
		for (const [table, column] of timestampColumns) {
			try {
				await adapter.exec(
					`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE BIGINT`,
				);
			} catch (_e) {
				// Column may not exist yet (added by later migration), ignore
			}
		}
	}


	await adapter.transaction(async () => {
		// Check accounts columns
		const accountsColumns = await getTableColumnsAsync(adapter, "accounts");

		// Add rate_limited_until column if it doesn't exist
		if (!accountsColumns.includes("rate_limited_until")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN rate_limited_until BIGINT",
			);
			log.info("Added rate_limited_until column to accounts table");
		}

		// Add session_start column if it doesn't exist
		if (!accountsColumns.includes("session_start")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN session_start BIGINT",
			);
			log.info("Added session_start column to accounts table");
		}

		// Add session_request_count column if it doesn't exist
		if (!accountsColumns.includes("session_request_count")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN session_request_count INTEGER DEFAULT 0",
			);
			log.info("Added session_request_count column to accounts table");
		}

		// Add paused column if it doesn't exist
		if (!accountsColumns.includes("paused")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN paused INTEGER DEFAULT 0",
			);
			log.info("Added paused column to accounts table");
		}

		// Add rate_limit_reset column if it doesn't exist
		if (!accountsColumns.includes("rate_limit_reset")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN rate_limit_reset BIGINT",
			);
			log.info("Added rate_limit_reset column to accounts table");
		}

		// Add rate_limit_status column if it doesn't exist
		if (!accountsColumns.includes("rate_limit_status")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN rate_limit_status TEXT",
			);
			log.info("Added rate_limit_status column to accounts table");
		}

		// Add rate_limit_remaining column if it doesn't exist
		if (!accountsColumns.includes("rate_limit_remaining")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN rate_limit_remaining INTEGER",
			);
			log.info("Added rate_limit_remaining column to accounts table");
		}

		// Add priority column if it doesn't exist
		if (!accountsColumns.includes("priority")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN priority INTEGER DEFAULT 0",
			);
			log.info("Added priority column to accounts table");
		}

		// Add auto_fallback_enabled column if it doesn't exist
		if (!accountsColumns.includes("auto_fallback_enabled")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN auto_fallback_enabled INTEGER DEFAULT 0",
			);
			log.info("Added auto_fallback_enabled column to accounts table");
		}

		// Add custom_endpoint column if it doesn't exist
		if (!accountsColumns.includes("custom_endpoint")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN custom_endpoint TEXT",
			);
			log.info("Added custom_endpoint column to accounts table");
		}

		// Add auto_refresh_enabled column if it doesn't exist
		if (!accountsColumns.includes("auto_refresh_enabled")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN auto_refresh_enabled INTEGER DEFAULT 0",
			);
			log.info("Added auto_refresh_enabled column to accounts table");
		}

		// Add model_mappings column for OpenAI-compatible providers
		if (!accountsColumns.includes("model_mappings")) {
			await adapter.exec("ALTER TABLE accounts ADD COLUMN model_mappings TEXT");
			log.info("Added model_mappings column to accounts table");
		}

		// Add cross_region_mode column for Bedrock cross-region inference configuration
		if (!accountsColumns.includes("cross_region_mode")) {
			await adapter.exec(
				"ALTER TABLE accounts ADD COLUMN cross_region_mode TEXT DEFAULT 'geographic'",
			);
			log.info("Added cross_region_mode column to accounts table");
		}

		// Run API key storage migration
		try {
			await runApiKeyStorageMigrationAsync(adapter);
		} catch (error) {
			log.error(
				`API key storage migration failed: ${(error as Error).message}`,
			);
			throw error;
		}

		// Check columns in oauth_sessions table
		const oauthColumns = await getTableColumnsAsync(adapter, "oauth_sessions");

		// Add custom_endpoint column to oauth_sessions if it doesn't exist
		if (!oauthColumns.includes("custom_endpoint")) {
			await adapter.exec(
				"ALTER TABLE oauth_sessions ADD COLUMN custom_endpoint TEXT",
			);
			log.info("Added custom_endpoint column to oauth_sessions table");
		}

		// Check columns in requests table
		const requestsColumns = await getTableColumnsAsync(adapter, "requests");

		// Add model column if it doesn't exist
		if (!requestsColumns.includes("model")) {
			await adapter.exec("ALTER TABLE requests ADD COLUMN model TEXT");
			log.info("Added model column to requests table");
		}

		// Add prompt_tokens column if it doesn't exist
		if (!requestsColumns.includes("prompt_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN prompt_tokens INTEGER DEFAULT 0",
			);
			log.info("Added prompt_tokens column to requests table");
		}

		// Add completion_tokens column if it doesn't exist
		if (!requestsColumns.includes("completion_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN completion_tokens INTEGER DEFAULT 0",
			);
			log.info("Added completion_tokens column to requests table");
		}

		// Add total_tokens column if it doesn't exist
		if (!requestsColumns.includes("total_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN total_tokens INTEGER DEFAULT 0",
			);
			log.info("Added total_tokens column to requests table");
		}

		// Add cost_usd column if it doesn't exist
		if (!requestsColumns.includes("cost_usd")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN cost_usd REAL DEFAULT 0",
			);
			log.info("Added cost_usd column to requests table");
		}

		// Add input_tokens column if it doesn't exist
		if (!requestsColumns.includes("input_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN input_tokens INTEGER DEFAULT 0",
			);
			log.info("Added input_tokens column to requests table");
		}

		// Add cache_read_input_tokens column if it doesn't exist
		if (!requestsColumns.includes("cache_read_input_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN cache_read_input_tokens INTEGER DEFAULT 0",
			);
			log.info("Added cache_read_input_tokens column to requests table");
		}

		// Add cache_creation_input_tokens column if it doesn't exist
		if (!requestsColumns.includes("cache_creation_input_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN cache_creation_input_tokens INTEGER DEFAULT 0",
			);
			log.info("Added cache_creation_input_tokens column to requests table");
		}

		// Add output_tokens column if it doesn't exist
		if (!requestsColumns.includes("output_tokens")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN output_tokens INTEGER DEFAULT 0",
			);
			log.info("Added output_tokens column to requests table");
		}

		// Add agent_used column if it doesn't exist
		if (!requestsColumns.includes("agent_used")) {
			await adapter.exec("ALTER TABLE requests ADD COLUMN agent_used TEXT");
			log.info("Added agent_used column to requests table");
		}

		// Add output_tokens_per_second column if it doesn't exist
		if (!requestsColumns.includes("output_tokens_per_second")) {
			await adapter.exec(
				"ALTER TABLE requests ADD COLUMN output_tokens_per_second REAL",
			);
			log.info("Added output_tokens_per_second column to requests table");
		}

		// Add api_key_id column if it doesn't exist
		if (!requestsColumns.includes("api_key_id")) {
			await adapter.exec("ALTER TABLE requests ADD COLUMN api_key_id TEXT");
			log.info("Added api_key_id column to requests table");
		}

		// Add api_key_name column if it doesn't exist
		if (!requestsColumns.includes("api_key_name")) {
			await adapter.exec("ALTER TABLE requests ADD COLUMN api_key_name TEXT");
			log.info("Added api_key_name column to requests table");
		}

		// Check columns in api_keys table
		const apiKeysColumns = await getTableColumnsAsync(adapter, "api_keys");

		// Add role column to api_keys if it doesn't exist
		if (!apiKeysColumns.includes("role")) {
			await adapter.exec(
				"ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'api-only'",
			);
			log.info("Added role column to api_keys table");

			// Update existing keys to 'admin' for backwards compatibility
			const updateResult = await adapter.run(
				"UPDATE api_keys SET role = 'admin' WHERE role = 'api-only'",
			);
			const updatedCount = updateResult.changes || 0;
			if (updatedCount > 0) {
				log.info(
					`Updated ${updatedCount} existing API key(s) to 'admin' role for backwards compatibility`,
				);
			}

			// Create index on role column
			await adapter.exec(
				"CREATE INDEX IF NOT EXISTS idx_api_keys_role ON api_keys(role)",
			);
			log.info("Created index on api_keys role column");
		}

		// Add performance indexes
		await addPerformanceIndexesAsync(adapter);

		// Remove tier columns if they exist (cleanup migration)
		// PostgreSQL supports ALTER TABLE DROP COLUMN directly
		const currentAccountsColumns = await getTableColumnsAsync(
			adapter,
			"accounts",
		);
		if (currentAccountsColumns.includes("account_tier")) {
			await adapter.exec("ALTER TABLE accounts DROP COLUMN account_tier");
			log.info("Removed account_tier column from accounts table");
		}

		const currentOAuthColumns = await getTableColumnsAsync(
			adapter,
			"oauth_sessions",
		);
		if (currentOAuthColumns.includes("tier")) {
			await adapter.exec("ALTER TABLE oauth_sessions DROP COLUMN tier");
			log.info("Removed tier column from oauth_sessions table");
		}

		// Update existing "max" mode values to "claude-oauth" in oauth_sessions table
		try {
			const updateCount = await adapter.run(
				`UPDATE oauth_sessions SET mode = 'claude-oauth' WHERE mode = 'max'`,
			);
			if (updateCount.changes > 0) {
				log.info(
					`Updated ${updateCount.changes} oauth_sessions records from 'max' to 'claude-oauth'`,
				);
			}
		} catch (error) {
			log.warn(
				`Error updating oauth_sessions mode values: ${(error as Error).message}`,
			);
		}

		// Migrate existing Claude console accounts from 'anthropic' to 'claude-console-api' provider
		try {
			const updateCount = await adapter.run(
				`UPDATE accounts SET provider = 'claude-console-api' WHERE provider = 'anthropic' AND api_key IS NOT NULL AND api_key != ''`,
			);
			if (updateCount.changes > 0) {
				log.info(
					`Updated ${updateCount.changes} accounts from 'anthropic' to 'claude-console-api' provider (console accounts)`,
				);
			}
		} catch (error) {
			log.warn(
				`Error updating account provider values: ${(error as Error).message}`,
			);
		}

		// Sanitize existing account names to prevent command injection
		try {
			const accounts = await adapter.query<{ id: string; name: string }>(
				`SELECT id, name FROM accounts`,
			);

			let sanitizedCount = 0;
			for (const account of accounts) {
				// Check if name contains any forbidden characters
				if (!/^[a-zA-Z0-9\-_]+$/.test(account.name)) {
					// Sanitize by replacing forbidden chars with underscores
					const sanitizedName = account.name.replace(/[^a-zA-Z0-9\-_]/g, "_");

					// Ensure name doesn't become duplicate
					let finalName = sanitizedName;
					let suffix = 1;
					while (
						accounts.some((a) => a.id !== account.id && a.name === finalName) ||
						(
							(await adapter.get<{ count: number }>(
								`SELECT COUNT(*) as count FROM accounts WHERE name = ?`,
								[finalName],
							)) as { count: number }
						).count > 0
					) {
						finalName = `${sanitizedName}_${suffix}`;
						suffix++;
					}

					await adapter.run(`UPDATE accounts SET name = ? WHERE id = ?`, [
						finalName,
						account.id,
					]);
					sanitizedCount++;
					log.info(
						`Sanitized account name: "${account.name}" -> "${finalName}"`,
					);
				}
			}

			if (sanitizedCount > 0) {
				log.info(
					`Sanitized ${sanitizedCount} account name(s) to prevent command injection`,
				);
			}
		} catch (error) {
			log.warn(`Error sanitizing account names: ${(error as Error).message}`);
		}

		// Populate default Claude model translations for Bedrock
		// Use INSERT INTO ... ON CONFLICT DO NOTHING instead of INSERT OR IGNORE
		const now = Date.now();
		const defaultMappings = [
			{
				id: "model-trans-1",
				client: "claude-3-5-sonnet-20241022",
				bedrock: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
			},
			{
				id: "model-trans-2",
				client: "claude-3-5-sonnet-20240620",
				bedrock: "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
			},
			{
				id: "model-trans-3",
				client: "claude-3-5-haiku-20241022",
				bedrock: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
			},
			{
				id: "model-trans-4",
				client: "claude-3-opus-20240229",
				bedrock: "us.anthropic.claude-3-opus-20240229-v1:0",
			},
			{
				id: "model-trans-5",
				client: "claude-3-sonnet-20240229",
				bedrock: "us.anthropic.claude-3-sonnet-20240229-v1:0",
			},
			{
				id: "model-trans-6",
				client: "claude-3-haiku-20240307",
				bedrock: "us.anthropic.claude-3-haiku-20240307-v1:0",
			},
			{
				id: "model-trans-7",
				client: "claude-3-5-sonnet",
				bedrock: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
			},
			{
				id: "model-trans-8",
				client: "claude-3-5-haiku",
				bedrock: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
			},
			{
				id: "model-trans-9",
				client: "claude-3-opus",
				bedrock: "us.anthropic.claude-3-opus-20240229-v1:0",
			},
			{
				id: "model-trans-10",
				client: "claude-3-sonnet",
				bedrock: "us.anthropic.claude-3-sonnet-20240229-v1:0",
			},
			{
				id: "model-trans-11",
				client: "claude-3-haiku",
				bedrock: "us.anthropic.claude-3-haiku-20240307-v1:0",
			},
		];

		for (const mapping of defaultMappings) {
			await adapter.run(
				`INSERT INTO model_translations (id, client_name, bedrock_model_id, is_default, auto_discovered, created_at, updated_at)
				 VALUES (?, ?, ?, 1, 0, ?, ?)
				 ON CONFLICT DO NOTHING`,
				[mapping.id, mapping.client, mapping.bedrock, now, now],
			);
		}

		const insertedCount = defaultMappings.length;
		log.info(
			`Populated ${insertedCount} default Claude model translations for Bedrock`,
		);
	});

	log.info("All database migrations completed successfully");
}

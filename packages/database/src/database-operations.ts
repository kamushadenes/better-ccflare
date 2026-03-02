import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeConfig } from "@better-ccflare/config";
import type { Disposable } from "@better-ccflare/core";
import type { Account, StrategyStore } from "@better-ccflare/types";
import type { AsyncDatabaseAdapter, DatabaseAdapter } from "./adapter";
import { runMigrationsAsync } from "./async-migrations";
import { AsyncSqliteAdapter } from "./async-sqlite-adapter";
import { createAsyncAdapter, getBackendType } from "./factory";
import { ensureSchema, runMigrations } from "./migrations";
import { resolveDbPath } from "./paths";
import { AccountRepository } from "./repositories/account.repository";
import { AgentPreferenceRepository } from "./repositories/agent-preference.repository";
import { ApiKeyRepository } from "./repositories/api-key.repository";
import { OAuthRepository } from "./repositories/oauth.repository";
import {
	type RequestData,
	RequestRepository,
} from "./repositories/request.repository";
import { StatsRepository } from "./repositories/stats.repository";
import { StrategyRepository } from "./repositories/strategy.repository";
import { withDatabaseRetry } from "./retry";
import { SqliteAdapter } from "./sqlite-adapter";

export interface DatabaseConfig {
	/** Enable WAL (Write-Ahead Logging) mode for better concurrency */
	walMode?: boolean;
	/** SQLite busy timeout in milliseconds */
	busyTimeoutMs?: number;
	/** Cache size in pages (negative value = KB) */
	cacheSize?: number;
	/** Synchronous mode: OFF, NORMAL, FULL */
	synchronous?: "OFF" | "NORMAL" | "FULL";
	/** Memory-mapped I/O size in bytes */
	mmapSize?: number;
	/** Retry configuration for database operations */
	retry?: DatabaseRetryConfig;
	/** Page size in bytes - default 2048 (2KB), recommend 4096 (4KB) for better memory efficiency */
	pageSize?: number;
}

export interface DatabaseRetryConfig {
	/** Maximum number of retry attempts for database operations */
	attempts?: number;
	/** Initial delay between retries in milliseconds */
	delayMs?: number;
	/** Backoff multiplier for exponential backoff */
	backoff?: number;
	/** Maximum delay between retries in milliseconds */
	maxDelayMs?: number;
}

/**
 * Apply SQLite pragmas for optimal performance on distributed filesystems
 * Integrates your performance improvements with the new architecture
 */
function configureSqlite(
	db: Database,
	config: DatabaseConfig,
	skipIntegrityCheck = false,
): void {
	try {
		// Check database integrity first (skip in fast mode for CLI commands)
		if (!skipIntegrityCheck) {
			const integrityResult = db.query("PRAGMA integrity_check").get() as {
				integrity_check: string;
			};
			if (integrityResult.integrity_check !== "ok") {
				console.error("\n❌ DATABASE INTEGRITY CHECK FAILED");
				console.error("═".repeat(50));
				console.error(`Error: ${integrityResult.integrity_check}\n`);
				console.error("Your database may be corrupted. To repair it, run:");
				console.error("  bun run cli --repair-db\n");
				console.error(`${"═".repeat(50)}\n`);
				throw new Error(
					`Database integrity check failed: ${integrityResult.integrity_check}`,
				);
			}
		}

		// Enable WAL mode for better concurrency (with error handling)
		if (config.walMode !== false) {
			try {
				const result = db.query("PRAGMA journal_mode = WAL").get() as {
					journal_mode: string;
				};
				if (result.journal_mode !== "wal") {
					console.warn(
						"Failed to enable WAL mode, falling back to DELETE mode",
					);
					db.run("PRAGMA journal_mode = DELETE");
				}
			} catch (error) {
				console.warn("WAL mode failed, using DELETE mode:", error);
				db.run("PRAGMA journal_mode = DELETE");
			}
		}

		// Set busy timeout for lock handling
		if (config.busyTimeoutMs !== undefined) {
			db.run(`PRAGMA busy_timeout = ${config.busyTimeoutMs}`);
		}

		// Configure cache size
		if (config.cacheSize !== undefined) {
			db.run(`PRAGMA cache_size = ${config.cacheSize}`);
		}

		// Set synchronous mode (more conservative for distributed filesystems)
		const syncMode = config.synchronous || "FULL"; // Default to FULL for safety
		db.run(`PRAGMA synchronous = ${syncMode}`);

		// Configure memory-mapped I/O (disable on distributed filesystems if problematic)
		if (config.mmapSize !== undefined && config.mmapSize > 0) {
			try {
				db.run(`PRAGMA mmap_size = ${config.mmapSize}`);
			} catch (error) {
				console.warn("Failed to set mmap_size:", error);
			}
		} else {
			// mmap_size of 0 means disabled (which is the intended default)
		}

		// Set page size (only effective before any data is written, or after VACUUM)
		// This is mainly for new databases - existing databases keep their page size
		if (config.pageSize !== undefined) {
			const currentPageSize = (
				db.query("PRAGMA page_size").get() as { page_size: number }
			).page_size;
			if (currentPageSize !== config.pageSize) {
				// Try to set page size (will only work on empty database or with VACUUM)
				db.run(`PRAGMA page_size = ${config.pageSize}`);
			}
		}

		// Additional optimizations for distributed filesystems
		db.run("PRAGMA temp_store = MEMORY");
		db.run("PRAGMA foreign_keys = ON");

		// Add checkpoint interval for WAL mode
		db.run("PRAGMA wal_autocheckpoint = 1000");
	} catch (error) {
		console.error("Database configuration failed:", error);
		throw new Error(`Failed to configure SQLite database: ${error}`);
	}
}

/**
 * DatabaseOperations using Repository Pattern
 * Provides a clean, organized interface for database operations
 */
export class DatabaseOperations implements StrategyStore, Disposable {
	private asyncAdapter: AsyncDatabaseAdapter;
	private syncAdapter?: SqliteAdapter;
	private db?: Database;
	private runtime?: RuntimeConfig;
	private dbConfig: DatabaseConfig;
	private retryConfig: DatabaseRetryConfig;
	private fastMode: boolean;

	// Repositories
	private accounts: AccountRepository;
	private requests: RequestRepository;
	private oauth: OAuthRepository;
	private strategy: StrategyRepository;
	private stats: StatsRepository;
	private agentPreferences: AgentPreferenceRepository;
	private apiKeys: ApiKeyRepository;

	private constructor(
		asyncAdapter: AsyncDatabaseAdapter,
		opts: {
			syncAdapter?: SqliteAdapter;
			db?: Database;
			dbConfig?: DatabaseConfig;
			retryConfig?: DatabaseRetryConfig;
			fastMode?: boolean;
		},
	) {
		this.asyncAdapter = asyncAdapter;
		this.syncAdapter = opts.syncAdapter;
		this.db = opts.db;
		this.dbConfig = opts.dbConfig ?? {};
		this.retryConfig = {
			attempts: 3,
			delayMs: 100,
			backoff: 2,
			maxDelayMs: 5000,
			...opts.retryConfig,
		};
		this.fastMode = opts.fastMode ?? false;

		// Initialize all repos with asyncAdapter
		this.accounts = new AccountRepository(asyncAdapter);
		this.requests = new RequestRepository(asyncAdapter);
		this.oauth = new OAuthRepository(asyncAdapter);
		this.strategy = new StrategyRepository(asyncAdapter);
		this.stats = new StatsRepository(asyncAdapter);
		this.agentPreferences = new AgentPreferenceRepository(asyncAdapter);
		this.apiKeys = new ApiKeyRepository(asyncAdapter);
	}

	static async create(
		dbPath?: string,
		dbConfig?: DatabaseConfig,
		retryConfig?: DatabaseRetryConfig,
		fastMode = false,
	): Promise<DatabaseOperations> {
		const dialect = getBackendType();

		if (dialect === "postgres") {
			const adapter = await createAsyncAdapter();
			// Test connection with retries - avoids crash loops that burn Cloud SQL API quota
			const maxRetries = 5;
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					await (adapter as any).testConnection();
					console.log("[Database] PostgreSQL connection verified");
					break;
				} catch (err) {
					console.error(`[Database] PostgreSQL connection attempt ${attempt}/${maxRetries} failed:`, (err as Error).message);
					if (attempt === maxRetries) {
						console.error("[Database] FATAL: All connection attempts exhausted. Crashing.");
						process.exit(1);
					}
					const delay = attempt * 2000;
					console.log(`[Database] Retrying in ${delay}ms...`);
					await new Promise(r => setTimeout(r, delay));
				}
			}
			// Run async migrations for PostgreSQL
			await runMigrationsAsync(adapter);
			console.log("[Database] PostgreSQL migrations completed");
			return new DatabaseOperations(adapter, { retryConfig, fastMode });
		}

		// SQLite path (existing logic)
		const resolvedPath = dbPath ?? resolveDbPath();
		mkdirSync(dirname(resolvedPath), { recursive: true });
		const mergedDbConfig: DatabaseConfig = {
			walMode: true,
			busyTimeoutMs: 10000,
			cacheSize: -5000,
			synchronous: "FULL",
			mmapSize: 0,
			pageSize: 2048,
			...dbConfig,
		};
		const sqliteAdapter = new SqliteAdapter(resolvedPath, { create: true });
		const rawDb = sqliteAdapter.getRawDatabase();
		configureSqlite(rawDb, mergedDbConfig, fastMode);
		ensureSchema(rawDb);
		runMigrations(rawDb, resolvedPath);
		const asyncAdapter = new AsyncSqliteAdapter(sqliteAdapter);
		return new DatabaseOperations(asyncAdapter, {
			syncAdapter: sqliteAdapter,
			db: rawDb,
			dbConfig: mergedDbConfig,
			retryConfig,
			fastMode,
		});
	}

	setRuntimeConfig(runtime: RuntimeConfig): void {
		this.runtime = runtime;

		// Update retry config from runtime config if available
		if (runtime.database?.retry) {
			this.retryConfig = {
				...this.retryConfig,
				...runtime.database.retry,
			};
		}
	}

	getDatabase(): Database {
		if (!this.db) {
			throw new Error(
				"getDatabase() only available with SQLite. Use getAsyncAdapter().",
			);
		}
		return this.db;
	}

	getAdapter(): DatabaseAdapter {
		if (!this.syncAdapter) {
			throw new Error(
				"getAdapter() only available with SQLite. Use getAsyncAdapter().",
			);
		}
		return this.syncAdapter;
	}

	getAsyncAdapter(): AsyncDatabaseAdapter {
		return this.asyncAdapter;
	}

	/**
	 * Run database integrity check if it was skipped during initialization
	 * This is useful for server startup where we want to ensure database integrity
	 */
	runIntegrityCheck(): void {
		if (!this.syncAdapter || !this.fastMode) return;
		// Database was initialized in fast mode, run integrity check now
		const integrityResult = this.syncAdapter.get<{
			integrity_check: string;
		}>("PRAGMA integrity_check");
		if (integrityResult && integrityResult.integrity_check !== "ok") {
			console.error("\n❌ DATABASE INTEGRITY CHECK FAILED");
			console.error("═".repeat(50));
			console.error(`Error: ${integrityResult.integrity_check}\n`);
			console.error("Your database may be corrupted. To repair it, run:");
			console.error("  bun run cli --repair-db\n");
			console.error(`${"═".repeat(50)}\n`);
			throw new Error(
				`Database integrity check failed: ${integrityResult.integrity_check}`,
			);
		}
	}

	/**
	 * Get the current retry configuration
	 */
	getRetryConfig(): DatabaseRetryConfig {
		return this.retryConfig;
	}

	// Account operations delegated to repository with retry logic
	async getAllAccounts(): Promise<Account[]> {
		return withDatabaseRetry(
			() => this.accounts.findAll(),
			this.retryConfig,
			"getAllAccounts",
		);
	}

	async getAccount(accountId: string): Promise<Account | null> {
		return withDatabaseRetry(
			() => this.accounts.findById(accountId),
			this.retryConfig,
			"getAccount",
		);
	}

	async updateAccountTokens(
		accountId: string,
		accessToken: string,
		expiresAt: number,
		refreshToken?: string,
	): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.accounts.updateTokens(
					accountId,
					accessToken,
					expiresAt,
					refreshToken,
				),
			this.retryConfig,
			"updateAccountTokens",
		);
	}

	async updateAccountUsage(accountId: string): Promise<void> {
		const sessionDuration =
			this.runtime?.sessionDurationMs || 5 * 60 * 60 * 1000;
		return withDatabaseRetry(
			() => this.accounts.incrementUsage(accountId, sessionDuration),
			this.retryConfig,
			"updateAccountUsage",
		);
	}

	async markAccountRateLimited(
		accountId: string,
		until: number,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.setRateLimited(accountId, until),
			this.retryConfig,
			"markAccountRateLimited",
		);
	}

	/**
	 * Clear expired rate_limited_until values from all accounts
	 * @param now The current timestamp to compare against
	 * @returns Number of accounts that had their rate_limited_until cleared
	 */
	async clearExpiredRateLimits(now: number): Promise<number> {
		return withDatabaseRetry(
			() => this.accounts.clearExpiredRateLimits(now),
			this.retryConfig,
			"clearExpiredRateLimits",
		);
	}

	async updateAccountRateLimitMeta(
		accountId: string,
		status: string,
		reset: number | null,
		remaining?: number | null,
	): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.accounts.updateRateLimitMeta(accountId, status, reset, remaining),
			this.retryConfig,
			"updateAccountRateLimitMeta",
		);
	}

	async forceResetAccountRateLimit(accountId: string): Promise<boolean> {
		return withDatabaseRetry(
			async () => {
				const changes = await this.accounts.clearRateLimitState(accountId);
				// 0 changes is fine when fields are already null — account still exists
				return changes >= 0;
			},
			this.retryConfig,
			"forceResetAccountRateLimit",
		);
	}

	async pauseAccount(accountId: string): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.pause(accountId),
			this.retryConfig,
			"pauseAccount",
		);
	}

	async resumeAccount(accountId: string): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.resume(accountId),
			this.retryConfig,
			"resumeAccount",
		);
	}

	async renameAccount(accountId: string, newName: string): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.rename(accountId, newName),
			this.retryConfig,
			"renameAccount",
		);
	}

	async resetAccountSession(
		accountId: string,
		timestamp: number,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.resetSession(accountId, timestamp),
			this.retryConfig,
			"resetAccountSession",
		);
	}

	async updateAccountRequestCount(
		accountId: string,
		count: number,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.updateRequestCount(accountId, count),
			this.retryConfig,
			"updateAccountRequestCount",
		);
	}

	async updateAccountPriority(
		accountId: string,
		priority: number,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.updatePriority(accountId, priority),
			this.retryConfig,
			"updateAccountPriority",
		);
	}

	async setAutoFallbackEnabled(
		accountId: string,
		enabled: boolean,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.accounts.setAutoFallbackEnabled(accountId, enabled),
			this.retryConfig,
			"setAutoFallbackEnabled",
		);
	}

	async hasAccountsForProvider(provider: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.accounts.hasAccountsForProvider(provider),
			this.retryConfig,
			"hasAccountsForProvider",
		);
	}

	// Request operations delegated to repository
	async saveRequestMeta(
		id: string,
		method: string,
		path: string,
		accountUsed: string | null,
		statusCode: number | null,
		timestamp?: number,
		apiKeyId?: string,
		apiKeyName?: string,
	): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.requests.saveMeta(
					id,
					method,
					path,
					accountUsed,
					statusCode,
					timestamp,
					apiKeyId,
					apiKeyName,
				),
			this.retryConfig,
			"saveRequestMeta",
		);
	}

	async saveRequest(
		id: string,
		method: string,
		path: string,
		accountUsed: string | null,
		statusCode: number | null,
		success: boolean,
		errorMessage: string | null,
		responseTime: number,
		failoverAttempts: number,
		usage?: RequestData["usage"],
		agentUsed?: string,
		apiKeyId?: string,
		apiKeyName?: string,
	): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.requests.save({
					id,
					method,
					path,
					accountUsed,
					statusCode,
					success,
					errorMessage,
					responseTime,
					failoverAttempts,
					usage,
					agentUsed,
					apiKeyId,
					apiKeyName,
				}),
			this.retryConfig,
			"saveRequest",
		);
	}

	async updateRequestUsage(
		requestId: string,
		usage: RequestData["usage"],
	): Promise<void> {
		return withDatabaseRetry(
			() => this.requests.updateUsage(requestId, usage),
			this.retryConfig,
			"updateRequestUsage",
		);
	}

	async saveRequestPayload(id: string, data: unknown): Promise<void> {
		return withDatabaseRetry(
			() => this.requests.savePayload(id, data),
			this.retryConfig,
			"saveRequestPayload",
		);
	}

	async saveRequestPayloadRaw(id: string, json: string): Promise<void> {
		return withDatabaseRetry(
			() => this.requests.savePayloadRaw(id, json),
			this.retryConfig,
			"saveRequestPayloadRaw",
		);
	}

	async getRequestPayload(id: string): Promise<unknown | null> {
		return withDatabaseRetry(
			() => this.requests.getPayload(id),
			this.retryConfig,
			"getRequestPayload",
		);
	}

	async listRequestPayloads(
		limit = 50,
	): Promise<Array<{ id: string; json: string }>> {
		return withDatabaseRetry(
			() => this.requests.listPayloads(limit),
			this.retryConfig,
			"listRequestPayloads",
		);
	}

	async listRequestPayloadsWithAccountNames(
		limit = 50,
	): Promise<Array<{ id: string; json: string; account_name: string | null }>> {
		return withDatabaseRetry(
			() => this.requests.listPayloadsWithAccountNames(limit),
			this.retryConfig,
			"listRequestPayloadsWithAccountNames",
		);
	}

	// OAuth operations delegated to repository
	async createOAuthSession(
		sessionId: string,
		accountName: string,
		verifier: string,
		mode: "console" | "claude-oauth",
		customEndpoint?: string,
		ttlMinutes = 10,
	): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.oauth.createSession(
					sessionId,
					accountName,
					verifier,
					mode,
					customEndpoint,
					ttlMinutes,
				),
			this.retryConfig,
			"createOAuthSession",
		);
	}

	async getOAuthSession(sessionId: string): Promise<{
		accountName: string;
		verifier: string;
		mode: "console" | "claude-oauth";
		customEndpoint?: string;
	} | null> {
		return withDatabaseRetry(
			() => this.oauth.getSession(sessionId),
			this.retryConfig,
			"getOAuthSession",
		);
	}

	async deleteOAuthSession(sessionId: string): Promise<void> {
		return withDatabaseRetry(
			() => this.oauth.deleteSession(sessionId),
			this.retryConfig,
			"deleteOAuthSession",
		);
	}

	async cleanupExpiredOAuthSessions(): Promise<number> {
		return withDatabaseRetry(
			() => this.oauth.cleanupExpiredSessions(),
			this.retryConfig,
			"cleanupExpiredOAuthSessions",
		);
	}

	// Strategy operations delegated to repository
	async getStrategy(name: string): Promise<{
		name: string;
		config: Record<string, unknown>;
		updatedAt: number;
	} | null> {
		return withDatabaseRetry(
			() => this.strategy.getStrategy(name),
			this.retryConfig,
			"getStrategy",
		);
	}

	async setStrategy(
		name: string,
		config: Record<string, unknown>,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.strategy.set(name, config),
			this.retryConfig,
			"setStrategy",
		);
	}

	async listStrategies(): Promise<
		Array<{
			name: string;
			config: Record<string, unknown>;
			updatedAt: number;
		}>
	> {
		return withDatabaseRetry(
			() => this.strategy.list(),
			this.retryConfig,
			"listStrategies",
		);
	}

	async deleteStrategy(name: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.strategy.delete(name),
			this.retryConfig,
			"deleteStrategy",
		);
	}

	// Analytics methods delegated to request repository
	async getRecentRequests(limit = 100): Promise<
		Array<{
			id: string;
			timestamp: number;
			method: string;
			path: string;
			account_used: string | null;
			status_code: number | null;
			success: boolean;
			response_time_ms: number | null;
		}>
	> {
		return withDatabaseRetry(
			() => this.requests.getRecentRequests(limit),
			this.retryConfig,
			"getRecentRequests",
		);
	}

	async getRequestStats(since?: number): Promise<{
		totalRequests: number;
		successfulRequests: number;
		failedRequests: number;
		avgResponseTime: number | null;
	}> {
		return withDatabaseRetry(
			() => this.requests.getRequestStats(since),
			this.retryConfig,
			"getRequestStats",
		);
	}

	async aggregateStats(rangeMs?: number) {
		return withDatabaseRetry(
			() => this.requests.aggregateStats(rangeMs),
			this.retryConfig,
			"aggregateStats",
		);
	}

	async getRecentErrors(limit?: number): Promise<string[]> {
		return withDatabaseRetry(
			() => this.requests.getRecentErrors(limit),
			this.retryConfig,
			"getRecentErrors",
		);
	}

	async getTopModels(
		limit?: number,
	): Promise<Array<{ model: string; count: number }>> {
		return withDatabaseRetry(
			() => this.requests.getTopModels(limit),
			this.retryConfig,
			"getTopModels",
		);
	}

	async getRequestsByAccount(since?: number): Promise<
		Array<{
			accountId: string;
			accountName: string | null;
			requestCount: number;
			successRate: number;
		}>
	> {
		return withDatabaseRetry(
			() => this.requests.getRequestsByAccount(since),
			this.retryConfig,
			"getRequestsByAccount",
		);
	}

	// Cleanup operations (payload by age; request metadata by age; plus orphan sweep)
	async cleanupOldRequests(
		payloadRetentionMs: number,
		requestRetentionMs?: number,
	): Promise<{
		removedRequests: number;
		removedPayloads: number;
	}> {
		const now = Date.now();
		const payloadCutoff = now - payloadRetentionMs;
		return this.asyncAdapter.transaction(async () => {
			let removedRequests = 0;
			if (
				typeof requestRetentionMs === "number" &&
				Number.isFinite(requestRetentionMs)
			) {
				removedRequests = await this.requests.deleteOlderThan(
					now - requestRetentionMs,
				);
			}
			const removedPayloadsByAge =
				await this.requests.deletePayloadsOlderThan(payloadCutoff);
			const removedOrphans = await this.requests.deleteOrphanedPayloads();
			return {
				removedRequests,
				removedPayloads: removedPayloadsByAge + removedOrphans,
			};
		});
	}

	// Agent preference operations delegated to repository
	async getAgentPreference(agentId: string): Promise<{ model: string } | null> {
		return withDatabaseRetry(
			() => this.agentPreferences.getPreference(agentId),
			this.retryConfig,
			"getAgentPreference",
		);
	}

	async getAllAgentPreferences(): Promise<
		Array<{ agent_id: string; model: string }>
	> {
		return withDatabaseRetry(
			() => this.agentPreferences.getAllPreferences(),
			this.retryConfig,
			"getAllAgentPreferences",
		);
	}

	async setAgentPreference(agentId: string, model: string): Promise<void> {
		return withDatabaseRetry(
			() => this.agentPreferences.setPreference(agentId, model),
			this.retryConfig,
			"setAgentPreference",
		);
	}

	async deleteAgentPreference(agentId: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.agentPreferences.deletePreference(agentId),
			this.retryConfig,
			"deleteAgentPreference",
		);
	}

	async setBulkAgentPreferences(
		agentIds: string[],
		model: string,
	): Promise<void> {
		return withDatabaseRetry(
			() => this.agentPreferences.setBulkPreferences(agentIds, model),
			this.retryConfig,
			"setBulkAgentPreferences",
		);
	}

	async close(): Promise<void> {
		if (this.syncAdapter) {
			this.syncAdapter.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		}
		await this.asyncAdapter.close();
	}

	async dispose(): Promise<void> {
		await this.close();
	}

	// Optimize database periodically to maintain performance
	optimize(): void {
		if (!this.syncAdapter) return;
		this.syncAdapter.exec("PRAGMA optimize");
		this.syncAdapter.exec("PRAGMA wal_checkpoint(PASSIVE)");
	}

	/** Compact and reclaim disk space (blocks DB during operation) */
	compact(): void {
		if (!this.syncAdapter) return;
		// Ensure WAL is checkpointed and truncated, then VACUUM to rebuild file
		this.syncAdapter.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		this.syncAdapter.exec("VACUUM");
	}

	/** Incremental vacuum - reclaims space without blocking (non-blocking alternative to VACUUM) */
	incrementalVacuum(pages?: number): void {
		if (!this.syncAdapter) return;
		// Set auto_vacuum to incremental if not already set
		const autoVacuumMode = this.syncAdapter.get<{
			auto_vacuum: number;
		}>("PRAGMA auto_vacuum");

		if (autoVacuumMode && autoVacuumMode.auto_vacuum !== 2) {
			// Enable incremental vacuum mode (requires VACUUM to take effect)
			this.syncAdapter.exec("PRAGMA auto_vacuum = INCREMENTAL");
			this.syncAdapter.exec("VACUUM"); // One-time full vacuum to enable incremental mode
		}

		// Run incremental vacuum (reclaims up to N pages, or all free pages if not specified)
		if (pages) {
			this.syncAdapter.exec(`PRAGMA incremental_vacuum(${pages})`);
		} else {
			this.syncAdapter.exec("PRAGMA incremental_vacuum");
		}
	}

	// API Key operations delegated to repository
	async getApiKeys() {
		return withDatabaseRetry(
			() => this.apiKeys.findAll(),
			this.retryConfig,
			"getApiKeys",
		);
	}

	async getActiveApiKeys() {
		return withDatabaseRetry(
			() => this.apiKeys.findActive(),
			this.retryConfig,
			"getActiveApiKeys",
		);
	}

	async getApiKey(id: string) {
		return withDatabaseRetry(
			() => this.apiKeys.findById(id),
			this.retryConfig,
			"getApiKey",
		);
	}

	async getApiKeyByHashedKey(hashedKey: string) {
		return withDatabaseRetry(
			() => this.apiKeys.findByHashedKey(hashedKey),
			this.retryConfig,
			"getApiKeyByHashedKey",
		);
	}

	async getApiKeyByName(name: string) {
		return withDatabaseRetry(
			() => this.apiKeys.findByName(name),
			this.retryConfig,
			"getApiKeyByName",
		);
	}

	async apiKeyNameExists(name: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.apiKeys.nameExists(name),
			this.retryConfig,
			"apiKeyNameExists",
		);
	}

	async createApiKey(apiKey: {
		id: string;
		name: string;
		hashedKey: string;
		prefixLast8: string;
		createdAt: number;
		lastUsed?: number | null;
		isActive: boolean;
		role?: "admin" | "api-only";
	}): Promise<void> {
		return withDatabaseRetry(
			() =>
				this.apiKeys.create({
					id: apiKey.id,
					name: apiKey.name,
					hashed_key: apiKey.hashedKey,
					prefix_last_8: apiKey.prefixLast8,
					created_at: apiKey.createdAt,
					last_used: apiKey.lastUsed || null,
					is_active: apiKey.isActive ? 1 : 0,
					role: apiKey.role || "api-only",
				}),
			this.retryConfig,
			"createApiKey",
		);
	}

	async updateApiKeyUsage(id: string, timestamp: number): Promise<void> {
		return withDatabaseRetry(
			() => this.apiKeys.updateUsage(id, timestamp),
			this.retryConfig,
			"updateApiKeyUsage",
		);
	}

	async disableApiKey(id: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.apiKeys.disable(id),
			this.retryConfig,
			"disableApiKey",
		);
	}

	async enableApiKey(id: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.apiKeys.enable(id),
			this.retryConfig,
			"enableApiKey",
		);
	}

	async deleteApiKey(id: string): Promise<boolean> {
		return withDatabaseRetry(
			() => this.apiKeys.delete(id),
			this.retryConfig,
			"deleteApiKey",
		);
	}

	async updateApiKeyRole(
		id: string,
		role: "admin" | "api-only",
	): Promise<boolean> {
		return withDatabaseRetry(
			() => this.apiKeys.updateRole(id, role),
			this.retryConfig,
			"updateApiKeyRole",
		);
	}

	async countActiveApiKeys(): Promise<number> {
		return withDatabaseRetry(
			() => this.apiKeys.countActive(),
			this.retryConfig,
			"countActiveApiKeys",
		);
	}

	async countAllApiKeys(): Promise<number> {
		return withDatabaseRetry(
			() => this.apiKeys.countAll(),
			this.retryConfig,
			"countAllApiKeys",
		);
	}

	/**
	 * Clear all API keys (for testing purposes)
	 */
	async clearApiKeys(): Promise<void> {
		return withDatabaseRetry(
			() => this.apiKeys.clearAll(),
			this.retryConfig,
			"clearApiKeys",
		);
	}

	/**
	 * Get the API key repository for direct access
	 */
	getApiKeyRepository(): ApiKeyRepository {
		return this.apiKeys;
	}

	/**
	 * Get the stats repository for consolidated stats access
	 */
	getStatsRepository(): StatsRepository {
		return this.stats;
	}
}

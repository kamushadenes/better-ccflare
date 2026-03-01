// Re-export the DatabaseOperations class
import { DatabaseOperations } from "./database-operations";
export { DatabaseOperations };

export type { RuntimeConfig } from "@better-ccflare/config";
// Re-export adapter types and implementation
export type {
	AsyncDatabaseAdapter,
	DatabaseAdapter,
	PostgresAdapterOptions,
	QueryParams,
	RunResult,
} from "./adapter";
// Re-export other utilities
export { AsyncDbWriter } from "./async-writer";
export type {
	DatabaseConfig,
	DatabaseRetryConfig,
} from "./database-operations";
export { DatabaseFactory } from "./factory";
export { migrateFromCcflare } from "./migrate-from-ccflare";
export { ensureSchema, runMigrations } from "./migrations";
export { getLegacyDbPath, resolveDbPath } from "./paths";
export { analyzeIndexUsage } from "./performance-indexes";
export type {
	ModelTranslation,
	SimilarModel,
} from "./repositories/model-translation.repository";
// Re-export repository classes
export { ModelTranslationRepository } from "./repositories/model-translation.repository";
// Re-export repository types
export type { StatsRepository } from "./repositories/stats.repository";
// Re-export retry utilities for external use (from your improvements)
export { withDatabaseRetry, withDatabaseRetrySync } from "./retry";
export {
	buildInsertIgnoreSql,
	buildUpsertSql,
	convertPlaceholders,
} from "./sql-utils";
export { SqliteAdapter } from "./sqlite-adapter";

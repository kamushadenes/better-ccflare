import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeConfig } from "@better-ccflare/config";
import { registerDisposable, unregisterDisposable } from "@better-ccflare/core";
import type { AsyncDatabaseAdapter, DatabaseDialect } from "./adapter";
import { AsyncSqliteAdapter } from "./async-sqlite-adapter";
import {
	type DatabaseConfig,
	DatabaseOperations,
	type DatabaseRetryConfig,
} from "./database-operations";
import { migrateFromCcflare } from "./migrate-from-ccflare";
import { resolveDbPath } from "./paths";
import { SqliteAdapter } from "./sqlite-adapter";

let instance: DatabaseOperations | null = null;
let instancePromise: Promise<DatabaseOperations> | null = null;
let dbPath: string | undefined;
let runtimeConfig: RuntimeConfig | undefined;
let migrationChecked = false;

let fastModeEnabled = false;

export function initialize(
	dbPathParam?: string,
	runtimeConfigParam?: RuntimeConfig,
	fastMode = false,
): void {
	dbPath = dbPathParam;
	runtimeConfig = runtimeConfigParam;
	// Store fast mode setting for database operations
	fastModeEnabled = fastMode;
}

export async function getInstance(
	fastMode?: boolean,
): Promise<DatabaseOperations> {
	// Use provided fastMode or the stored value from initialize()
	const useFastMode = fastMode ?? fastModeEnabled;
	if (!instance) {
		if (!instancePromise) {
			instancePromise = (async () => {
				// Perform one-time migration check from legacy ccflare
				if (!migrationChecked) {
					migrateFromCcflare();
					migrationChecked = true;
				}
				// Extract database configuration from runtime config
				const dbConfig: DatabaseConfig | undefined = runtimeConfig?.database
					? {
							...(runtimeConfig.database.walMode !== undefined && {
								walMode: runtimeConfig.database.walMode,
							}),
							...(runtimeConfig.database.busyTimeoutMs !== undefined && {
								busyTimeoutMs: runtimeConfig.database.busyTimeoutMs,
							}),
							...(runtimeConfig.database.cacheSize !== undefined && {
								cacheSize: runtimeConfig.database.cacheSize,
							}),
							...(runtimeConfig.database.synchronous !== undefined && {
								synchronous: runtimeConfig.database.synchronous,
							}),
							...(runtimeConfig.database.mmapSize !== undefined && {
								mmapSize: runtimeConfig.database.mmapSize,
							}),
							...(runtimeConfig.database.pageSize !== undefined && {
								pageSize: runtimeConfig.database.pageSize,
							}),
						}
					: undefined;

				const retryConfig: DatabaseRetryConfig | undefined =
					runtimeConfig?.database?.retry;

				const ops = await DatabaseOperations.create(
					dbPath,
					dbConfig,
					retryConfig,
					useFastMode,
				);
				if (runtimeConfig) {
					ops.setRuntimeConfig(runtimeConfig);
				}
				// Register with lifecycle manager
				registerDisposable(ops);
				instance = ops;
				instancePromise = null;
				return ops;
			})();
		}
		return instancePromise;
	}
	return instance;
}

export async function closeAll(): Promise<void> {
	if (instance) {
		unregisterDisposable(instance);
		await instance.close();
		instance = null;
		instancePromise = null;
	}
}

export async function reset(): Promise<void> {
	await closeAll();
}

export function getBackendType(): DatabaseDialect {
	return process.env.DATABASE_URL ? "postgres" : "sqlite";
}

export async function createAsyncAdapter(options?: {
	dbPath?: string;
}): Promise<AsyncDatabaseAdapter> {
	const dialect = getBackendType();
	if (dialect === "postgres") {
		const { PostgresAdapter } = await import("./postgres-adapter");
		return new PostgresAdapter(process.env.DATABASE_URL as string);
	}
	const resolvedPath = options?.dbPath ?? resolveDbPath();
	const dir = dirname(resolvedPath);
	mkdirSync(dir, { recursive: true });
	const sqliteAdapter = new SqliteAdapter(resolvedPath, { create: true });
	return new AsyncSqliteAdapter(sqliteAdapter);
}

export const DatabaseFactory = {
	initialize,
	getInstance,
	closeAll,
	reset,
	getBackendType,
	createAsyncAdapter,
};

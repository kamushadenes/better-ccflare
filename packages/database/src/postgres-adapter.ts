import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import type {
	AsyncDatabaseAdapter,
	DatabaseDialect,
	PostgresAdapterOptions,
	QueryParams,
	RunResult,
} from "./adapter";
import { convertPlaceholders } from "./sql-utils";

export class PostgresAdapter implements AsyncDatabaseAdapter {
	readonly dialect: DatabaseDialect = "postgres";
	private sql: postgres.Sql;
	private txStorage = new AsyncLocalStorage<postgres.TransactionSql>();

	constructor(connectionString: string, options?: PostgresAdapterOptions) {
		this.sql = postgres(connectionString, {
			max: options?.max ?? 3,
			idle_timeout: options?.idleTimeout ?? 30,
			connect_timeout: options?.connectTimeout ?? 30,
			max_lifetime: options?.maxLifetime ?? null,
			ssl: options?.ssl
				? typeof options.ssl === "boolean"
					? "require"
					: options.ssl
				: undefined,
		});
	}

	private get activeSql(): postgres.Sql | postgres.TransactionSql {
		return this.txStorage.getStore() ?? this.sql;
	}

	async query<R = Record<string, unknown>>(
		sql: string,
		params: QueryParams = [],
	): Promise<R[]> {
		const pgSql = convertPlaceholders(sql);
		const result = await this.activeSql.unsafe(
			pgSql,
			params as readonly (string | number | boolean | null | Buffer)[],
		);
		return [...result] as R[];
	}

	async get<R = Record<string, unknown>>(
		sql: string,
		params: QueryParams = [],
	): Promise<R | null> {
		const rows = await this.query<R>(sql, params);
		return rows[0] ?? null;
	}

	async run(sql: string, params: QueryParams = []): Promise<RunResult> {
		const pgSql = convertPlaceholders(sql);
		const result = await this.activeSql.unsafe(
			pgSql,
			params as readonly (string | number | boolean | null | Buffer)[],
		);
		return { changes: result.count };
	}

	async exec(sql: string): Promise<void> {
		await this.activeSql.unsafe(sql);
	}

	async testConnection(): Promise<void> {
		const result = await this.sql`SELECT 1 as ok`;
		if (!result || result.length === 0) {
			throw new Error(
				"PostgreSQL connection test failed: no result from SELECT 1",
			);
		}
	}

	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		return this.sql.begin(async (tx) => {
			return this.txStorage.run(tx, fn);
		}) as Promise<T>;
	}

	async close(): Promise<void> {
		await this.sql.end({ timeout: 5 });
	}
}

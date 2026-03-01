export type QueryParams = Array<string | number | boolean | null | Buffer>;

export interface RunResult {
	changes: number;
}

export interface DatabaseAdapter {
	/** Execute a query returning multiple rows */
	query<R = Record<string, unknown>>(sql: string, params?: QueryParams): R[];

	/** Execute a query returning a single row or null */
	get<R = Record<string, unknown>>(sql: string, params?: QueryParams): R | null;

	/** Execute a statement (INSERT/UPDATE/DELETE) */
	run(sql: string, params?: QueryParams): RunResult;

	/** Execute raw SQL (DDL, multiple statements, PRAGMAs) */
	exec(sql: string): void;

	/** Execute a function within a transaction */
	transaction<T>(fn: () => T): T;

	/** Close the database connection */
	close(): void;
}

export interface AsyncDatabaseAdapter {
	/** Execute a query returning multiple rows */
	query<R = Record<string, unknown>>(
		sql: string,
		params?: QueryParams,
	): Promise<R[]>;

	/** Execute a query returning a single row or null */
	get<R = Record<string, unknown>>(
		sql: string,
		params?: QueryParams,
	): Promise<R | null>;

	/** Execute a statement (INSERT/UPDATE/DELETE) */
	run(sql: string, params?: QueryParams): Promise<RunResult>;

	/** Execute raw SQL (DDL, multiple statements) */
	exec(sql: string): Promise<void>;

	/** Execute a function within a transaction */
	transaction<T>(fn: () => Promise<T>): Promise<T>;

	/** Close the database connection */
	close(): Promise<void>;
}

export interface PostgresAdapterOptions {
	/** Maximum number of connections in the pool (default: 10) */
	max?: number;
	/** Seconds before idle connections are closed (default: 30) */
	idleTimeout?: number;
	/** Seconds to wait for a connection (default: 30) */
	connectTimeout?: number;
	/** Maximum lifetime of a connection in seconds (default: null = forever) */
	maxLifetime?: number | null;
	/** Enable SSL. True for require, or pass options object */
	ssl?: boolean | "require" | "allow" | "prefer" | "verify-full";
}

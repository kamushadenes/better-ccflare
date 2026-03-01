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

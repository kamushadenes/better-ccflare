import { Database } from "bun:sqlite";
import type { DatabaseAdapter, DatabaseDialect, QueryParams, RunResult } from "./adapter";

export class SqliteAdapter implements DatabaseAdapter {
	readonly dialect: DatabaseDialect = "sqlite";
	private db: Database;

	constructor(
		path: string,
		options?: { create?: boolean; readonly?: boolean },
	) {
		this.db = new Database(path, options);
	}

	query<R>(sql: string, params: QueryParams = []): R[] {
		return this.db.query<R, QueryParams>(sql).all(...params) as R[];
	}

	get<R>(sql: string, params: QueryParams = []): R | null {
		return (this.db.query<R, QueryParams>(sql).get(...params) as R) ?? null;
	}

	run(sql: string, params: QueryParams = []): RunResult {
		const result = this.db.run(sql, params);
		return { changes: result.changes };
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	transaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	close(): void {
		this.db.close();
	}

	/** Escape hatch: get raw bun:sqlite Database for legacy callers */
	getRawDatabase(): Database {
		return this.db;
	}
}

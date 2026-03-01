import type { Database } from "bun:sqlite";
import type {
	AsyncDatabaseAdapter,
	DatabaseDialect,
	QueryParams,
	RunResult,
} from "./adapter";
import type { SqliteAdapter } from "./sqlite-adapter";

export class AsyncSqliteAdapter implements AsyncDatabaseAdapter {
	readonly dialect: DatabaseDialect = "sqlite";
	private inTransaction = false;

	constructor(private sync: SqliteAdapter) {}

	async query<R = Record<string, unknown>>(
		sql: string,
		params?: QueryParams,
	): Promise<R[]> {
		return this.sync.query<R>(sql, params);
	}

	async get<R = Record<string, unknown>>(
		sql: string,
		params?: QueryParams,
	): Promise<R | null> {
		return this.sync.get<R>(sql, params);
	}

	async run(sql: string, params?: QueryParams): Promise<RunResult> {
		return this.sync.run(sql, params);
	}

	async exec(sql: string): Promise<void> {
		this.sync.exec(sql);
	}

	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		if (this.inTransaction) {
			throw new Error(
				"Nested transactions are not supported with SQLite backend",
			);
		}
		this.inTransaction = true;
		await this.exec("BEGIN");
		try {
			const result = await fn();
			await this.exec("COMMIT");
			return result;
		} catch (e) {
			await this.exec("ROLLBACK");
			throw e;
		} finally {
			this.inTransaction = false;
		}
	}

	async close(): Promise<void> {
		this.sync.close();
	}

	getRawDatabase(): Database {
		return this.sync.getRawDatabase();
	}

	getSyncAdapter(): SqliteAdapter {
		return this.sync;
	}
}

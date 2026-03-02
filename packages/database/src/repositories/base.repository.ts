import type { AsyncDatabaseAdapter, QueryParams } from "../adapter";

export abstract class BaseRepository<_T> {
	constructor(protected db: AsyncDatabaseAdapter) {}

	protected async query<R>(
		sql: string,
		params: QueryParams = [],
	): Promise<R[]> {
		return this.db.query<R>(sql, params);
	}

	protected async get<R>(
		sql: string,
		params: QueryParams = [],
	): Promise<R | null> {
		return this.db.get<R>(sql, params);
	}

	protected async run(sql: string, params: QueryParams = []): Promise<void> {
		await this.db.run(sql, params);
	}

	protected async runWithChanges(
		sql: string,
		params: QueryParams = [],
	): Promise<number> {
		const result = await this.db.run(sql, params);
		return result.changes;
	}
}

import type { DatabaseAdapter, QueryParams } from "../adapter";

export abstract class BaseRepository<_T> {
	constructor(protected db: DatabaseAdapter) {}

	protected query<R>(sql: string, params: QueryParams = []): R[] {
		return this.db.query<R>(sql, params);
	}

	protected get<R>(sql: string, params: QueryParams = []): R | null {
		return this.db.get<R>(sql, params);
	}

	protected run(sql: string, params: QueryParams = []): void {
		this.db.run(sql, params);
	}

	protected runWithChanges(sql: string, params: QueryParams = []): number {
		return this.db.run(sql, params).changes;
	}
}

import type { AsyncDatabaseAdapter } from "./adapter";
import { buildInsertIgnoreSql } from "./sql-utils";
import { SqliteAdapter } from "./sqlite-adapter";

export interface TableMigrationResult {
	table: string;
	rowsMigrated: number;
	skipped: boolean;
}

export interface MigrationResult {
	tables: TableMigrationResult[];
	totalRows: number;
	durationMs: number;
}

const TABLE_ORDER = [
	"accounts",
	"requests",
	"request_payloads",
	"oauth_sessions",
	"agent_preferences",
	"api_keys",
	"model_translations",
	"strategies",
];

const BATCH_SIZE = 100;

export async function migrateToPostgres(
	sqlitePath: string,
	target: AsyncDatabaseAdapter,
): Promise<MigrationResult> {
	const start = Date.now();
	const source = new SqliteAdapter(sqlitePath, { readonly: true });
	const results: TableMigrationResult[] = [];

	try {
		for (const table of TABLE_ORDER) {
			// Check if table exists in source
			const exists = source.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
				[table],
			);

			if (!exists) {
				results.push({ table, rowsMigrated: 0, skipped: true });
				console.log(`Migrating ${table}... skipped (not found)`);
				continue;
			}

			// Get columns dynamically
			const columnsInfo = source.query<{ name: string }>(
				`PRAGMA table_info(${table})`,
			);
			const columns = columnsInfo.map((c) => c.name);

			// Read all rows
			const rows = source.query<Record<string, unknown>>(
				`SELECT * FROM ${table}`,
			);

			// Insert in batches
			if (rows.length > 0) {
				const sql = buildInsertIgnoreSql(table, columns);
				for (let i = 0; i < rows.length; i += BATCH_SIZE) {
					const batch = rows.slice(i, i + BATCH_SIZE);
					for (const row of batch) {
						const params = columns.map((col) => {
							const val = row[col];
							if (val === undefined) return null;
							return val as string | number | boolean | null;
						});
						await target.run(sql, params);
					}
				}
			}

			results.push({ table, rowsMigrated: rows.length, skipped: false });
			console.log(`Migrating ${table}... ${rows.length} rows`);
		}
	} finally {
		source.close();
	}

	const totalRows = results.reduce((sum, r) => sum + r.rowsMigrated, 0);
	return {
		tables: results,
		totalRows,
		durationMs: Date.now() - start,
	};
}

export function convertPlaceholders(sql: string): string {
	let index = 0;
	return sql.replace(/\?/g, () => `$${++index}`);
}

export function buildUpsertSql(
	table: string,
	columns: string[],
	conflictColumns: string[],
): string {
	const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
	const colList = columns.join(", ");
	const conflictList = conflictColumns.join(", ");
	const updateColumns = columns.filter((c) => !conflictColumns.includes(c));

	if (updateColumns.length === 0) {
		return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictList}) DO NOTHING`;
	}

	const setClauses = updateColumns
		.map((c) => `${c} = EXCLUDED.${c}`)
		.join(", ");
	return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictList}) DO UPDATE SET ${setClauses}`;
}

export function buildInsertIgnoreSql(
	table: string,
	columns: string[],
): string {
	const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
	const colList = columns.join(", ");
	return `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
}

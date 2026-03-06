import { DatabaseFactory } from "@better-ccflare/database";
import type { DatabaseOperations } from "@better-ccflare/database";
import { TIME_CONSTANTS } from "@better-ccflare/core";
import { analyzeIndexUsage } from "@better-ccflare/database";

/**
 * Analyze query performance and index usage
 */
export async function analyzePerformance(
	dbOps: DatabaseOperations,
): Promise<void> {
	console.log("\n=== Database Performance Analysis ===\n");

	const backend = DatabaseFactory.getBackendType();

	if (backend === "sqlite") {
		const db = dbOps.getDatabase();
		// Basic index usage analysis (SQLite-specific)
		analyzeIndexUsage(db);

		// Show detailed query performance for common patterns
		console.log("\n=== Query Performance Metrics ===\n");

		const performanceQueries = [
			{
				name: "Recent requests (last 24h)",
				query: `
				SELECT COUNT(*) as count
				FROM requests
				WHERE timestamp > ?
			`,
				params: [Date.now() - TIME_CONSTANTS.DAY],
			},
			{
				name: "Active accounts",
				query: `
				SELECT COUNT(*) as count
				FROM accounts
				WHERE paused = 0
			`,
				params: [],
			},
			{
				name: "Model usage distribution",
				query: `
				SELECT model, COUNT(*) as count
				FROM requests
				WHERE model IS NOT NULL AND timestamp > ?
				GROUP BY model
				ORDER BY count DESC
				LIMIT 5
			`,
				params: [Date.now() - TIME_CONSTANTS.DAY],
			},
		];

		for (const test of performanceQueries) {
			try {
				const start = performance.now();
				const stmt = db.prepare(test.query);
				const result = stmt.all(...test.params);
				const duration = performance.now() - start;

				console.log(`${test.name}:`);
				console.log(`  Time: ${duration.toFixed(2)}ms`);
				console.log(`  Results: ${JSON.stringify(result)}\n`);
			} catch (error) {
				console.error(`${test.name}: Error - ${error}`);
			}
		}

		// Check if statistics need updating
		console.log("=== Index Optimization Status ===\n");

		const lastAnalyze = db
			.prepare(`SELECT * FROM sqlite_stat1 LIMIT 1`)
			.get();

		if (!lastAnalyze) {
			console.log("⚠️  No index statistics found. Running ANALYZE...");
			db.exec("ANALYZE");
			console.log("✓ Index statistics updated");
		} else {
			console.log("✓ Index statistics are available");
		}

		// Show index coverage
		const indexedColumns = db
			.prepare(
				`
			SELECT
				m.tbl_name as table_name,
				COUNT(DISTINCT m.name) as index_count
			FROM sqlite_master m
			WHERE m.type = 'index'
				AND m.name NOT LIKE 'sqlite_%'
				AND m.sql IS NOT NULL
			GROUP BY m.tbl_name
		`,
			)
			.all() as Array<{ table_name: string; index_count: number }>;

		console.log("\n=== Index Coverage ===\n");
		for (const table of indexedColumns) {
			console.log(`${table.table_name}: ${table.index_count} indexes`);
		}
	} else {
		// PostgreSQL — run basic queries via async adapter
		const adapter = dbOps.getAsyncAdapter();

		console.log("=== Query Performance Metrics ===\n");

		const now = Date.now();
		const dayAgo = now - TIME_CONSTANTS.DAY;

		const recentCount = await adapter.get<{ count: number }>(
			"SELECT COUNT(*) as count FROM requests WHERE timestamp > $1",
			[dayAgo],
		);
		console.log(`Recent requests (last 24h): ${recentCount?.count ?? 0}`);

		const activeCount = await adapter.get<{ count: number }>(
			"SELECT COUNT(*) as count FROM accounts WHERE paused = false",
			[],
		);
		console.log(`Active accounts: ${activeCount?.count ?? 0}`);

		const models = await adapter.query<{ model: string; count: number }>(
			"SELECT model, COUNT(*) as count FROM requests WHERE model IS NOT NULL AND timestamp > $1 GROUP BY model ORDER BY count DESC LIMIT 5",
			[dayAgo],
		);
		console.log(`\nModel usage distribution:`);
		for (const row of models) {
			console.log(`  ${row.model}: ${row.count}`);
		}

		console.log("\nNote: Index analysis not available for PostgreSQL backend");
	}

	console.log("\n✓ Analysis complete");
}

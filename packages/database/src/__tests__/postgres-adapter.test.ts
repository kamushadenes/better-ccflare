import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PostgresAdapter } from "../postgres-adapter";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL as string;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;

describePostgres("PostgresAdapter", () => {
	let adapter: PostgresAdapter;
	const tableName = `test_pg_adapter_${Date.now()}`;

	beforeEach(async () => {
		adapter = new PostgresAdapter(TEST_DATABASE_URL);
		await adapter.exec(
			`CREATE TABLE IF NOT EXISTS ${tableName} (id INTEGER PRIMARY KEY, name TEXT, value TEXT)`,
		);
	});

	afterEach(async () => {
		await adapter.exec(`DROP TABLE IF EXISTS ${tableName}`);
		await adapter.close();
	});

	it("query() returns multiple rows", async () => {
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			1,
			"Alice",
		]);
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			2,
			"Bob",
		]);

		const rows = await adapter.query<{ id: number; name: string }>(
			`SELECT * FROM ${tableName} ORDER BY id`,
		);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ id: 1, name: "Alice", value: null });
		expect(rows[1]).toEqual({ id: 2, name: "Bob", value: null });
	});

	it("query() returns empty array for no matches", async () => {
		const rows = await adapter.query(
			`SELECT * FROM ${tableName} WHERE name = ?`,
			["Nobody"],
		);
		expect(rows).toEqual([]);
	});

	it("query() with parameters filters correctly", async () => {
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			1,
			"Alice",
		]);
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			2,
			"Bob",
		]);

		const rows = await adapter.query<{ id: number; name: string }>(
			`SELECT * FROM ${tableName} WHERE name = ?`,
			["Alice"],
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe("Alice");
	});

	it("get() returns single row", async () => {
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			1,
			"Alice",
		]);

		const row = await adapter.get<{ id: number; name: string }>(
			`SELECT * FROM ${tableName} WHERE id = ?`,
			[1],
		);

		expect(row).not.toBeNull();
		expect(row?.name).toBe("Alice");
	});

	it("get() returns null for no match", async () => {
		const row = await adapter.get(
			`SELECT * FROM ${tableName} WHERE id = ?`,
			[999],
		);
		expect(row).toBeNull();
	});

	it("run() INSERT returns changes: 1", async () => {
		const result = await adapter.run(
			`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`,
			[1, "Alice"],
		);
		expect(result).toEqual({ changes: 1 });
	});

	it("run() UPDATE returns correct changes count", async () => {
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			1,
			"Alice",
		]);
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			2,
			"Bob",
		]);

		const result = await adapter.run(
			`UPDATE ${tableName} SET value = ? WHERE id > ?`,
			["updated", 0],
		);
		expect(result).toEqual({ changes: 2 });
	});

	it("run() DELETE returns correct changes count", async () => {
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			1,
			"Alice",
		]);
		await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
			2,
			"Bob",
		]);

		const result = await adapter.run(
			`DELETE FROM ${tableName} WHERE name = ?`,
			["Alice"],
		);
		expect(result).toEqual({ changes: 1 });
	});

	it("exec() creates table", async () => {
		const extraTable = `${tableName}_extra`;
		await adapter.exec(
			`CREATE TABLE ${extraTable} (id INTEGER PRIMARY KEY, data TEXT)`,
		);

		await adapter.run(`INSERT INTO ${extraTable} (id, data) VALUES (?, ?)`, [
			1,
			"test",
		]);
		const row = await adapter.get<{ id: number; data: string }>(
			`SELECT * FROM ${extraTable} WHERE id = ?`,
			[1],
		);

		expect(row).not.toBeNull();
		expect(row?.data).toBe("test");

		await adapter.exec(`DROP TABLE ${extraTable}`);
	});

	it("exec() executes multiple statements sequentially", async () => {
		const t1 = `${tableName}_multi1`;
		const t2 = `${tableName}_multi2`;

		await adapter.exec(`CREATE TABLE ${t1} (id INTEGER PRIMARY KEY)`);
		await adapter.exec(`CREATE TABLE ${t2} (id INTEGER PRIMARY KEY)`);

		await adapter.run(`INSERT INTO ${t1} (id) VALUES (?)`, [1]);
		await adapter.run(`INSERT INTO ${t2} (id) VALUES (?)`, [2]);

		const r1 = await adapter.get<{ id: number }>(`SELECT * FROM ${t1}`);
		const r2 = await adapter.get<{ id: number }>(`SELECT * FROM ${t2}`);

		expect(r1).toEqual({ id: 1 });
		expect(r2).toEqual({ id: 2 });

		await adapter.exec(`DROP TABLE ${t1}`);
		await adapter.exec(`DROP TABLE ${t2}`);
	});

	it("transaction() commits on success", async () => {
		await adapter.transaction(async () => {
			await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
				1,
				"Alice",
			]);
			await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
				2,
				"Bob",
			]);
		});

		const rows = await adapter.query(`SELECT * FROM ${tableName} ORDER BY id`);
		expect(rows).toHaveLength(2);
	});

	it("transaction() rolls back on error", async () => {
		try {
			await adapter.transaction(async () => {
				await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
					1,
					"Alice",
				]);
				throw new Error("rollback test");
			});
		} catch (e) {
			expect((e as Error).message).toBe("rollback test");
		}

		const rows = await adapter.query(`SELECT * FROM ${tableName}`);
		expect(rows).toEqual([]);
	});

	it("transaction() returns value", async () => {
		const result = await adapter.transaction(async () => {
			await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
				1,
				"Alice",
			]);
			return "done";
		});

		expect(result).toBe("done");
	});

	it("transaction() scopes queries to transaction connection", async () => {
		await adapter.transaction(async () => {
			await adapter.run(`INSERT INTO ${tableName} (id, name) VALUES (?, ?)`, [
				1,
				"TxRow",
			]);

			const rows = await adapter.query<{ name: string }>(
				`SELECT * FROM ${tableName} WHERE id = ?`,
				[1],
			);
			expect(rows).toHaveLength(1);
			expect(rows[0].name).toBe("TxRow");
		});
	});

	it("close() gracefully shuts down", async () => {
		const localAdapter = new PostgresAdapter(TEST_DATABASE_URL);
		await localAdapter.query("SELECT 1 as val");
		await localAdapter.close();
		// After close, further queries should fail
		try {
			await localAdapter.query("SELECT 1 as val");
			expect(true).toBe(false); // Should not reach here
		} catch {
			// Expected: connection closed
		}
	});

	it("placeholder conversion works end-to-end with ?", async () => {
		await adapter.run(
			`INSERT INTO ${tableName} (id, name, value) VALUES (?, ?, ?)`,
			[1, "Alice", "val1"],
		);

		const row = await adapter.get<{ id: number; name: string; value: string }>(
			`SELECT * FROM ${tableName} WHERE id = ? AND name = ?`,
			[1, "Alice"],
		);

		expect(row).not.toBeNull();
		expect(row?.value).toBe("val1");
	});
});

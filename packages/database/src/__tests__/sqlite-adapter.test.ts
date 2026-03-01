import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { SqliteAdapter } from "../sqlite-adapter";

describe("SqliteAdapter", () => {
	it("query() returns matching rows with params", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
		adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Alice"]);
		adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [2, "Bob"]);

		const rows = adapter.query<{ id: number; name: string }>(
			"SELECT * FROM users WHERE name = ?",
			["Alice"],
		);

		expect(rows).toEqual([{ id: 1, name: "Alice" }]);
		adapter.close();
	});

	it("query() returns empty array for no matches", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		const rows = adapter.query<{ id: number; name: string }>(
			"SELECT * FROM users WHERE name = ?",
			["Nobody"],
		);

		expect(rows).toEqual([]);
		adapter.close();
	});

	it("get() returns single row for match", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
		adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Alice"]);

		const row = adapter.get<{ id: number; name: string }>(
			"SELECT * FROM users WHERE id = ?",
			[1],
		);

		expect(row).toEqual({ id: 1, name: "Alice" });
		adapter.close();
	});

	it("get() returns null for no match", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		const row = adapter.get<{ id: number; name: string }>(
			"SELECT * FROM users WHERE id = ?",
			[999],
		);

		expect(row).toBeNull();
		adapter.close();
	});

	it("run() INSERT returns { changes: 1 }", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		const result = adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [
			1,
			"Alice",
		]);

		expect(result).toEqual({ changes: 1 });
		adapter.close();
	});

	it("run() UPDATE with no matching rows returns { changes: 0 }", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		const result = adapter.run("UPDATE users SET name = ? WHERE 1 = 0", [
			"Nobody",
		]);

		expect(result).toEqual({ changes: 0 });
		adapter.close();
	});

	it("exec() executes raw SQL and creates table", () => {
		const adapter = new SqliteAdapter(":memory:");

		adapter.exec(
			"CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO items (id, value) VALUES (1, 'test');",
		);

		const row = adapter.get<{ id: number; value: string }>(
			"SELECT * FROM items WHERE id = ?",
			[1],
		);

		expect(row).toEqual({ id: 1, value: "test" });
		adapter.close();
	});

	it("transaction() commits and returns result", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		const result = adapter.transaction(() => {
			adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Alice"]);
			adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [2, "Bob"]);
			return adapter.query<{ id: number }>(
				"SELECT COUNT(*) as count FROM users",
			);
		});

		expect(result).toEqual([{ count: 2 }]);

		const rows = adapter.query<{ id: number; name: string }>(
			"SELECT * FROM users ORDER BY id",
		);
		expect(rows).toHaveLength(2);
		adapter.close();
	});

	it("transaction() rolls back on error and re-throws", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

		expect(() => {
			adapter.transaction(() => {
				adapter.run("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Alice"]);
				throw new Error("rollback test");
			});
		}).toThrow("rollback test");

		const rows = adapter.query("SELECT * FROM users");
		expect(rows).toEqual([]);
		adapter.close();
	});

	it("close() causes subsequent operations to throw", () => {
		const adapter = new SqliteAdapter(":memory:");
		adapter.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
		adapter.close();

		expect(() => {
			adapter.query("SELECT * FROM users");
		}).toThrow();
	});

	it("getRawDatabase() returns underlying Database instance", () => {
		const adapter = new SqliteAdapter(":memory:");

		const rawDb = adapter.getRawDatabase();

		expect(rawDb).toBeInstanceOf(Database);
		adapter.close();
	});
});

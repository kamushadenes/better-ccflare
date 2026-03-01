import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncSqliteAdapter } from "../async-sqlite-adapter";
import { SqliteAdapter } from "../sqlite-adapter";

describe("AsyncSqliteAdapter", () => {
	let tmpDir: string;
	let sqliteAdapter: SqliteAdapter;
	let adapter: AsyncSqliteAdapter;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "async-sqlite-test-"));
		sqliteAdapter = new SqliteAdapter(join(tmpDir, "test.db"), {
			create: true,
		});
		adapter = new AsyncSqliteAdapter(sqliteAdapter);
		sqliteAdapter.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
	});

	afterEach(() => {
		adapter.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("dialect returns 'sqlite'", () => {
		expect(adapter.dialect).toBe("sqlite");
	});

	test("query returns rows", async () => {
		sqliteAdapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [
			1,
			"alice",
		]);
		const rows = await adapter.query<{ id: number; name: string }>(
			"SELECT * FROM test",
		);
		expect(rows).toEqual([{ id: 1, name: "alice" }]);
	});

	test("get returns single row", async () => {
		sqliteAdapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [1, "bob"]);
		const row = await adapter.get<{ id: number; name: string }>(
			"SELECT * FROM test WHERE id = ?",
			[1],
		);
		expect(row).toEqual({ id: 1, name: "bob" });
	});

	test("get returns null for no match", async () => {
		const row = await adapter.get("SELECT * FROM test WHERE id = ?", [999]);
		expect(row).toBeNull();
	});

	test("run returns changes count", async () => {
		await adapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [1, "test"]);
		const result = await adapter.run("UPDATE test SET name = ? WHERE id = ?", [
			"updated",
			1,
		]);
		expect(result.changes).toBe(1);
	});

	test("exec executes DDL", async () => {
		await adapter.exec("CREATE TABLE test2 (id INTEGER PRIMARY KEY)");
		const rows = await adapter.query(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='test2'",
		);
		expect(rows.length).toBe(1);
	});

	test("transaction commits on success", async () => {
		await adapter.transaction(async () => {
			await adapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [
				1,
				"tx-test",
			]);
			await adapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [
				2,
				"tx-test2",
			]);
		});
		const rows = await adapter.query("SELECT * FROM test");
		expect(rows.length).toBe(2);
	});

	test("transaction rolls back on error", async () => {
		try {
			await adapter.transaction(async () => {
				await adapter.run("INSERT INTO test (id, name) VALUES (?, ?)", [
					1,
					"should-rollback",
				]);
				throw new Error("deliberate error");
			});
		} catch {
			// expected
		}
		const rows = await adapter.query("SELECT * FROM test");
		expect(rows.length).toBe(0);
	});

	test("close delegates to underlying adapter", async () => {
		const localSqlite = new SqliteAdapter(join(tmpDir, "close-test.db"), {
			create: true,
		});
		const localAdapter = new AsyncSqliteAdapter(localSqlite);
		await localAdapter.close();
		expect(() => localSqlite.exec("SELECT 1")).toThrow();
	});

	test("getSyncAdapter returns underlying SqliteAdapter", () => {
		expect(adapter.getSyncAdapter()).toBe(sqliteAdapter);
	});

	test("nested transaction throws", async () => {
		let nestedError: Error | undefined;
		await adapter.transaction(async () => {
			try {
				await adapter.transaction(async () => {});
			} catch (e) {
				nestedError = e as Error;
			}
		});
		expect(nestedError).toBeDefined();
		expect(nestedError?.message).toBe(
			"Nested transactions are not supported with SQLite backend",
		);
	});
});

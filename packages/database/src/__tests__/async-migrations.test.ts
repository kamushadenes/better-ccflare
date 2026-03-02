import { describe, expect, mock, test } from "bun:test";
import type { AsyncDatabaseAdapter } from "../adapter";
import { getTableColumnsAsync } from "../async-migrations";

function createMockAdapter(
	queryResult: Record<string, unknown>[] = [],
): AsyncDatabaseAdapter {
	return {
		query: mock(() => Promise.resolve(queryResult)),
		get: mock(() => Promise.resolve(null)),
		run: mock(() => Promise.resolve({ changes: 0 })),
		exec: mock(() => Promise.resolve()),
		transaction: mock(<T>(fn: () => Promise<T>) => fn()),
		close: mock(() => Promise.resolve()),
	};
}

describe("getTableColumnsAsync", () => {
	test("returns column names from information_schema", async () => {
		const adapter = createMockAdapter([
			{ column_name: "id" },
			{ column_name: "name" },
		]);
		const cols = await getTableColumnsAsync(adapter, "accounts");
		expect(cols).toEqual(["id", "name"]);
	});

	test("returns empty array for non-existent table", async () => {
		const adapter = createMockAdapter([]);
		const cols = await getTableColumnsAsync(adapter, "nonexistent");
		expect(cols).toEqual([]);
	});

	test("passes table name as parameter to query", async () => {
		const adapter = createMockAdapter([]);
		await getTableColumnsAsync(adapter, "accounts");
		expect(adapter.query).toHaveBeenCalledWith(
			expect.stringContaining("information_schema.columns"),
			["accounts"],
		);
	});
});

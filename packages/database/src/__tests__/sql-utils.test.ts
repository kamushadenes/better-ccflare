import { describe, expect, it } from "bun:test";
import {
	buildInsertIgnoreSql,
	buildUpsertSql,
	convertPlaceholders,
} from "../sql-utils";

describe("convertPlaceholders", () => {
	it("converts single ? to $1", () => {
		const result = convertPlaceholders("SELECT * FROM t WHERE id = ?");
		expect(result).toBe("SELECT * FROM t WHERE id = $1");
	});

	it("converts multiple ? to sequential $N", () => {
		const result = convertPlaceholders(
			"INSERT INTO t (a, b, c) VALUES (?, ?, ?)",
		);
		expect(result).toBe("INSERT INTO t (a, b, c) VALUES ($1, $2, $3)");
	});

	it("returns input unchanged when no ? present", () => {
		const result = convertPlaceholders("SELECT 1");
		expect(result).toBe("SELECT 1");
	});

	it("handles ? in complex SQL with many values", () => {
		const result = convertPlaceholders(
			"INSERT INTO accounts (id, name, provider, key, endpoint) VALUES (?, ?, ?, ?, ?)",
		);
		expect(result).toBe(
			"INSERT INTO accounts (id, name, provider, key, endpoint) VALUES ($1, $2, $3, $4, $5)",
		);
	});

	it("handles dynamic IN clause with multiple ?", () => {
		const result = convertPlaceholders(
			"SELECT * FROM t WHERE status = ? AND id IN (?, ?, ?)",
		);
		expect(result).toBe(
			"SELECT * FROM t WHERE status = $1 AND id IN ($2, $3, $4)",
		);
	});
});

describe("buildUpsertSql", () => {
	it("generates correct upsert for single conflict column", () => {
		const result = buildUpsertSql(
			"strategies",
			["name", "config", "updated_at"],
			["name"],
		);
		expect(result).toBe(
			"INSERT INTO strategies (name, config, updated_at) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET config = EXCLUDED.config, updated_at = EXCLUDED.updated_at",
		);
	});

	it("generates correct upsert for multiple conflict columns", () => {
		const result = buildUpsertSql(
			"stats",
			["account_id", "date", "requests", "tokens"],
			["account_id", "date"],
		);
		expect(result).toBe(
			"INSERT INTO stats (account_id, date, requests, tokens) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, date) DO UPDATE SET requests = EXCLUDED.requests, tokens = EXCLUDED.tokens",
		);
	});

	it("uses EXCLUDED syntax in SET clause", () => {
		const result = buildUpsertSql("items", ["id", "value"], ["id"]);
		expect(result).toContain("EXCLUDED.value");
		expect(result).not.toContain("EXCLUDED.id");
	});

	it("omits conflict columns from SET clause", () => {
		const result = buildUpsertSql("t", ["a", "b", "c", "d"], ["a", "c"]);
		expect(result).toContain("DO UPDATE SET b = EXCLUDED.b, d = EXCLUDED.d");
		expect(result).not.toContain("a = EXCLUDED.a");
		expect(result).not.toContain("c = EXCLUDED.c");
	});

	it("falls back to DO NOTHING when all columns are conflict columns", () => {
		const result = buildUpsertSql("t", ["id", "name"], ["id", "name"]);
		expect(result).toBe(
			"INSERT INTO t (id, name) VALUES ($1, $2) ON CONFLICT (id, name) DO NOTHING",
		);
	});
});

describe("buildInsertIgnoreSql", () => {
	it("generates correct insert-ignore for single column", () => {
		const result = buildInsertIgnoreSql("t", ["id"]);
		expect(result).toBe(
			"INSERT INTO t (id) VALUES ($1) ON CONFLICT DO NOTHING",
		);
	});

	it("generates correct insert-ignore for multiple columns", () => {
		const result = buildInsertIgnoreSql("model_translations", [
			"id",
			"client_name",
			"bedrock_model_id",
		]);
		expect(result).toBe(
			"INSERT INTO model_translations (id, client_name, bedrock_model_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
		);
	});

	it("uses sequential $N placeholders", () => {
		const result = buildInsertIgnoreSql("t", ["a", "b", "c", "d", "e"]);
		expect(result).toContain("VALUES ($1, $2, $3, $4, $5)");
	});
});

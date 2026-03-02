import { describe, expect, mock, test } from "bun:test";
import type {
	AsyncDatabaseAdapter,
	DatabaseDialect,
	QueryParams,
} from "../adapter";
import { AgentPreferenceRepository } from "../repositories/agent-preference.repository";
import { ModelTranslationRepository } from "../repositories/model-translation.repository";
import { RequestRepository } from "../repositories/request.repository";
import { StrategyRepository } from "../repositories/strategy.repository";

function createMockAdapter(dialect: DatabaseDialect) {
	const runCalls: Array<{ sql: string; params: QueryParams }> = [];
	return {
		dialect,
		query: mock(() => Promise.resolve([])),
		get: mock(() => Promise.resolve(null)),
		run: mock((sql: string, params?: QueryParams) => {
			runCalls.push({ sql, params: params ?? [] });
			return Promise.resolve({ changes: 1 });
		}),
		exec: mock(() => Promise.resolve()),
		transaction: mock((fn: () => Promise<unknown>) => fn()),
		close: mock(() => Promise.resolve()),
		_runCalls: runCalls,
	} satisfies AsyncDatabaseAdapter & { _runCalls: typeof runCalls };
}

describe("Dialect-aware SQL", () => {
	describe("RequestRepository", () => {
		test("save() uses INSERT OR REPLACE for sqlite", async () => {
			const adapter = createMockAdapter("sqlite");
			const repo = new RequestRepository(adapter);
			await repo.save({
				id: "req-1",
				method: "POST",
				path: "/v1/messages",
				accountUsed: "acc-1",
				statusCode: 200,
				success: true,
				errorMessage: null,
				responseTime: 100,
				failoverAttempts: 0,
			});
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("INSERT OR REPLACE");
		});

		test("save() uses ON CONFLICT for postgres", async () => {
			const adapter = createMockAdapter("postgres");
			const repo = new RequestRepository(adapter);
			await repo.save({
				id: "req-1",
				method: "POST",
				path: "/v1/messages",
				accountUsed: "acc-1",
				statusCode: 200,
				success: true,
				errorMessage: null,
				responseTime: 100,
				failoverAttempts: 0,
			});
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("ON CONFLICT");
		});
		test("savePayload() uses ON CONFLICT for postgres", async () => {
			const adapter = createMockAdapter("postgres");
			const repo = new RequestRepository(adapter);
			await repo.savePayload("req-1", { test: true });
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("ON CONFLICT");
		});

		test("savePayload() uses INSERT OR REPLACE for sqlite", async () => {
			const adapter = createMockAdapter("sqlite");
			const repo = new RequestRepository(adapter);
			await repo.savePayload("req-1", { test: true });
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("INSERT OR REPLACE");
		});
	});

	describe("StrategyRepository", () => {
		test("set() uses INSERT OR REPLACE for sqlite", async () => {
			const adapter = createMockAdapter("sqlite");
			const repo = new StrategyRepository(adapter);
			await repo.set("test-strategy", { key: "value" });
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("INSERT OR REPLACE");
		});

		test("set() uses ON CONFLICT for postgres", async () => {
			const adapter = createMockAdapter("postgres");
			const repo = new StrategyRepository(adapter);
			await repo.set("test-strategy", { key: "value" });
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("ON CONFLICT");
		});
	});

	describe("AgentPreferenceRepository", () => {
		test("setPreference() uses INSERT OR REPLACE for sqlite", async () => {
			const adapter = createMockAdapter("sqlite");
			const repo = new AgentPreferenceRepository(adapter);
			await repo.setPreference("agent-1", "claude-3-opus");
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("INSERT OR REPLACE");
		});

		test("setPreference() uses ON CONFLICT for postgres", async () => {
			const adapter = createMockAdapter("postgres");
			const repo = new AgentPreferenceRepository(adapter);
			await repo.setPreference("agent-1", "claude-3-opus");
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("ON CONFLICT");
		});
	});

	describe("ModelTranslationRepository", () => {
		test("addTranslation() uses INSERT OR IGNORE for sqlite", async () => {
			const adapter = createMockAdapter("sqlite");
			const repo = new ModelTranslationRepository(adapter);
			await repo.addTranslation(
				"claude-3-opus",
				"us.anthropic.claude-3-opus",
				false,
			);
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("INSERT OR IGNORE");
		});

		test("addTranslation() uses ON CONFLICT DO NOTHING for postgres", async () => {
			const adapter = createMockAdapter("postgres");
			const repo = new ModelTranslationRepository(adapter);
			await repo.addTranslation(
				"claude-3-opus",
				"us.anthropic.claude-3-opus",
				false,
			);
			expect(adapter._runCalls.length).toBeGreaterThan(0);
			expect(adapter._runCalls[0].sql).toContain("ON CONFLICT DO NOTHING");
		});
	});
});

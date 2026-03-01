import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncSqliteAdapter } from "../async-sqlite-adapter";
import { createAsyncAdapter, getBackendType } from "../factory";

describe("getBackendType", () => {
	const originalDbUrl = process.env.DATABASE_URL;

	afterEach(() => {
		if (originalDbUrl !== undefined) {
			process.env.DATABASE_URL = originalDbUrl;
		} else {
			delete process.env.DATABASE_URL;
		}
	});

	test("returns 'sqlite' when DATABASE_URL is not set", () => {
		delete process.env.DATABASE_URL;
		expect(getBackendType()).toBe("sqlite");
	});

	test("returns 'postgres' when DATABASE_URL is set", () => {
		process.env.DATABASE_URL = "postgresql://localhost/test";
		expect(getBackendType()).toBe("postgres");
	});
});

describe("createAsyncAdapter", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "factory-test-"));
		delete process.env.DATABASE_URL;
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns AsyncSqliteAdapter when DATABASE_URL is not set", async () => {
		const adapter = await createAsyncAdapter({
			dbPath: join(tmpDir, "test.db"),
		});
		expect(adapter).toBeInstanceOf(AsyncSqliteAdapter);
		expect(adapter.dialect).toBe("sqlite");
		await adapter.close();
	});

	test("uses custom dbPath", async () => {
		const customPath = join(tmpDir, "custom.db");
		const adapter = await createAsyncAdapter({ dbPath: customPath });
		expect(adapter.dialect).toBe("sqlite");
		const { existsSync } = await import("node:fs");
		expect(existsSync(customPath)).toBe(true);
		await adapter.close();
	});
});

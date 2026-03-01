import { describe, expect, it } from "bun:test";
import {
	isRetryablePostgresError,
	RETRYABLE_POSTGRES_CODES,
} from "../postgres-retry";

describe("isRetryablePostgresError", () => {
	it("identifies serialization_failure (40001) as retryable", () => {
		const error = Object.assign(new Error("test"), { code: "40001" });
		expect(isRetryablePostgresError(error)).toBe(true);
	});

	it("identifies deadlock_detected (40P01) as retryable", () => {
		const error = Object.assign(new Error("test"), { code: "40P01" });
		expect(isRetryablePostgresError(error)).toBe(true);
	});

	it("identifies lock_not_available (55P03) as retryable", () => {
		const error = Object.assign(new Error("test"), { code: "55P03" });
		expect(isRetryablePostgresError(error)).toBe(true);
	});

	it("identifies connection errors as retryable", () => {
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "08006" }),
			),
		).toBe(true);
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "08001" }),
			),
		).toBe(true);
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "08003" }),
			),
		).toBe(true);
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "08004" }),
			),
		).toBe(true);
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "57P01" }),
			),
		).toBe(true);
	});

	it("identifies connection message errors as retryable", () => {
		expect(
			isRetryablePostgresError(new Error("CONNECTION_CLOSED unexpectedly")),
		).toBe(true);
		expect(
			isRetryablePostgresError(new Error("CONNECTION_ENDED by server")),
		).toBe(true);
		expect(isRetryablePostgresError(new Error("CONNECT_TIMEOUT"))).toBe(true);
		expect(isRetryablePostgresError(new Error("CONNECTION_DESTROYED"))).toBe(
			true,
		);
	});

	it("rejects non-retryable errors", () => {
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "42P01" }),
			),
		).toBe(false);
		expect(
			isRetryablePostgresError(
				Object.assign(new Error("test"), { code: "23505" }),
			),
		).toBe(false);
		expect(isRetryablePostgresError(new Error("syntax error"))).toBe(false);
	});

	it("handles non-Error objects gracefully", () => {
		expect(isRetryablePostgresError(null)).toBe(false);
		expect(isRetryablePostgresError(undefined)).toBe(false);
		expect(isRetryablePostgresError("string error")).toBe(false);
		expect(isRetryablePostgresError(42)).toBe(false);
		expect(isRetryablePostgresError({ code: "40001" })).toBe(true);
	});
});

describe("RETRYABLE_POSTGRES_CODES", () => {
	it("contains expected PostgreSQL error codes", () => {
		expect(RETRYABLE_POSTGRES_CODES).toContain("40001");
		expect(RETRYABLE_POSTGRES_CODES).toContain("40P01");
		expect(RETRYABLE_POSTGRES_CODES).toContain("55P03");
		expect(RETRYABLE_POSTGRES_CODES).toContain("57P01");
		expect(RETRYABLE_POSTGRES_CODES).toContain("08006");
	});
});

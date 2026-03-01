export const RETRYABLE_POSTGRES_CODES = [
	"40001", // serialization_failure
	"40P01", // deadlock_detected
	"55P03", // lock_not_available
	"57P01", // admin_shutdown
	"08006", // connection_failure
	"08001", // sqlclient_unable_to_establish_sqlconnection
	"08003", // connection_does_not_exist
	"08004", // sqlserver_rejected_establishment_of_sqlconnection
];

const RETRYABLE_POSTGRES_MESSAGES = [
	"CONNECTION_CLOSED",
	"CONNECTION_ENDED",
	"CONNECTION_DESTROYED",
	"CONNECT_TIMEOUT",
];

export function isRetryablePostgresError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const code = "code" in error ? String(error.code) : "";
	if (RETRYABLE_POSTGRES_CODES.includes(code)) return true;

	const message = error instanceof Error ? error.message : "";
	return RETRYABLE_POSTGRES_MESSAGES.some((msg) => message.includes(msg));
}

import { Logger } from "@better-ccflare/logger";
import type { AsyncDatabaseAdapter } from "./adapter";

const log = new Logger("PerformanceIndexes");

/**
 * Add performance indexes to improve query performance (async version for PostgreSQL)
 * This migration adds indexes based on common query patterns in the application
 */
export async function addPerformanceIndexesAsync(
	adapter: AsyncDatabaseAdapter,
): Promise<void> {
	log.info("Adding performance indexes...");

	// 1. Composite index on requests(timestamp, account_used) for time-based account queries
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_timestamp_account 
		ON requests(timestamp DESC, account_used)
	`);
	log.info("Added index: idx_requests_timestamp_account");

	// 2. Index on requests(model, timestamp) for model analytics
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_model_timestamp 
		ON requests(model, timestamp DESC) 
		WHERE model IS NOT NULL
	`);
	log.info("Added index: idx_requests_model_timestamp");

	// 3. Index on requests(success, timestamp) for success rate calculations
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_success_timestamp 
		ON requests(success, timestamp DESC)
	`);
	log.info("Added index: idx_requests_success_timestamp");

	// 4. Index on accounts(paused) for finding active accounts
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_paused 
		ON accounts(paused) 
		WHERE paused = 0
	`);
	log.info("Added index: idx_accounts_paused");

	// 5. Index on requests(account_used, timestamp) for per-account analytics
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_account_timestamp 
		ON requests(account_used, timestamp DESC)
	`);
	log.info("Added index: idx_requests_account_timestamp");

	// 6. Additional indexes based on observed query patterns

	// Index for cost analysis queries
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_cost_model 
		ON requests(cost_usd, model, timestamp DESC) 
		WHERE cost_usd > 0 AND model IS NOT NULL
	`);
	log.info("Added index: idx_requests_cost_model");

	// Index for response time analysis (for p95 calculations)
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_response_time 
		ON requests(model, response_time_ms) 
		WHERE response_time_ms IS NOT NULL AND model IS NOT NULL
	`);
	log.info("Added index: idx_requests_response_time");

	// Index for token usage analysis
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_tokens 
		ON requests(timestamp DESC, total_tokens) 
		WHERE total_tokens > 0
	`);
	log.info("Added index: idx_requests_tokens");

	// Index for account name lookups (used in analytics joins)
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_name 
		ON accounts(name)
	`);
	log.info("Added index: idx_accounts_name");

	// Index for rate limit checks
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_rate_limited 
		ON accounts(rate_limited_until) 
		WHERE rate_limited_until IS NOT NULL
	`);
	log.info("Added index: idx_accounts_rate_limited");

	// Index for session management
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_session 
		ON accounts(session_start, session_request_count) 
		WHERE session_start IS NOT NULL
	`);
	log.info("Added index: idx_accounts_session");

	// Composite index for account ordering in load balancer
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_request_count
		ON accounts(request_count DESC, last_used)
	`);
	log.info("Added index: idx_accounts_request_count");

	// Index for account priority in load balancer
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_accounts_priority
		ON accounts(priority ASC, request_count DESC, last_used)
	`);
	log.info("Added index: idx_accounts_priority");

	// Index for OAuth session cleanup by account_name
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_oauth_sessions_account_name
		ON oauth_sessions(account_name, expires_at)
	`);
	log.info("Added index: idx_oauth_sessions_account_name");

	// Index for API key filtering
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_api_key
		ON requests(api_key_id)
		WHERE api_key_id IS NOT NULL
	`);
	log.info("Added index: idx_requests_api_key");

	// Composite index for API key analytics (filtering + time-based queries)
	await adapter.exec(`
		CREATE INDEX IF NOT EXISTS idx_requests_api_key_timestamp
		ON requests(api_key_id, timestamp DESC)
		WHERE api_key_id IS NOT NULL
	`);
	log.info("Added index: idx_requests_api_key_timestamp");

	log.info("Performance indexes added successfully");
}

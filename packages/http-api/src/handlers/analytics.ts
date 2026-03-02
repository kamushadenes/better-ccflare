import type { DatabaseOperations } from "@better-ccflare/database";
import {
	errorResponse,
	InternalServerError,
	jsonResponse,
} from "@better-ccflare/http-common";
import { Logger } from "@better-ccflare/logger";
import { NO_ACCOUNT_ID } from "@better-ccflare/types";
import type { AnalyticsResponse } from "../types";

const log = new Logger("AnalyticsHandler");

interface BucketConfig {
	bucketMs: number;
	displayName: string;
}

function getRangeConfig(range: string): {
	startMs: number;
	bucket: BucketConfig;
} {
	const now = Date.now();
	const hour = 60 * 60 * 1000;
	const day = 24 * hour;

	switch (range) {
		case "1h":
			return {
				startMs: now - hour,
				bucket: { bucketMs: 60 * 1000, displayName: "1m" },
			};
		case "6h":
			return {
				startMs: now - 6 * hour,
				bucket: { bucketMs: 5 * 60 * 1000, displayName: "5m" },
			};
		case "24h":
			return {
				startMs: now - day,
				bucket: { bucketMs: hour, displayName: "1h" },
			};
		case "7d":
			return {
				startMs: now - 7 * day,
				bucket: { bucketMs: hour, displayName: "1h" },
			};
		case "30d":
			return {
				startMs: now - 30 * day,
				bucket: { bucketMs: day, displayName: "1d" },
			};
		default:
			return {
				startMs: now - day,
				bucket: { bucketMs: hour, displayName: "1h" },
			};
	}
}

export function createAnalyticsHandler(dbOps: DatabaseOperations) {
	return async (params: URLSearchParams): Promise<Response> => {
		const adapter = dbOps.getAsyncAdapter();
		const range = params.get("range") ?? "24h";
		const { startMs, bucket } = getRangeConfig(range);
		const mode = params.get("mode") ?? "normal";
		const isCumulative = mode === "cumulative";

		// Extract filters
		const accountsFilter =
			params.get("accounts")?.split(",").filter(Boolean) || [];
		const modelsFilter = params.get("models")?.split(",").filter(Boolean) || [];
		const apiKeysFilter =
			params.get("apiKeys")?.split(",").filter(Boolean) || [];
		const statusFilter = params.get("status") || "all";

		// Build filter conditions
		const conditions: string[] = ["timestamp > ?"];
		const queryParams: (string | number)[] = [startMs];

		if (accountsFilter.length > 0) {
			// Handle account filter - map account names to IDs via join
			const placeholders = accountsFilter.map(() => "?").join(",");
			conditions.push(`(
				r.account_used IN (SELECT id FROM accounts WHERE name IN (${placeholders}))
				OR (r.account_used = ? AND ? IN (${placeholders}))
			)`);
			queryParams.push(
				...accountsFilter,
				NO_ACCOUNT_ID,
				NO_ACCOUNT_ID,
				...accountsFilter,
			);
		}

		if (modelsFilter.length > 0) {
			const placeholders = modelsFilter.map(() => "?").join(",");
			conditions.push(`model IN (${placeholders})`);
			queryParams.push(...modelsFilter);
		}

		if (apiKeysFilter.length > 0) {
			const placeholders = apiKeysFilter.map(() => "?").join(",");
			conditions.push(`api_key_name IN (${placeholders})`);
			queryParams.push(...apiKeysFilter);
		}

		if (statusFilter === "success") {
			conditions.push("success = true");
		} else if (statusFilter === "error") {
			conditions.push("success = false");
		}

		const whereClause = conditions.join(" AND ");

		try {
			// Check if we need per-model time series
			const includeModelBreakdown = params.get("modelBreakdown") === "true";

			// Consolidated query to get totals
			const consolidatedResult = await adapter.get<{
				total_requests: number;
				success_rate: number;
				avg_response_time: number;
				total_tokens: number;
				total_cost_usd: number;
				avg_tokens_per_second: number;
				active_accounts: number;
				input_tokens: number;
				cache_read_input_tokens: number;
				cache_creation_input_tokens: number;
				output_tokens: number;
			}>(
				`SELECT
					COUNT(*) as total_requests,
					SUM(CASE WHEN success = true THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as success_rate,
					AVG(response_time_ms) as avg_response_time,
					SUM(COALESCE(total_tokens, 0)) as total_tokens,
					SUM(COALESCE(cost_usd, 0)) as total_cost_usd,
					AVG(output_tokens_per_second) as avg_tokens_per_second,
					COUNT(DISTINCT COALESCE(account_used, ?)) as active_accounts,
					SUM(COALESCE(input_tokens, 0)) as input_tokens,
					SUM(COALESCE(cache_read_input_tokens, 0)) as cache_read_input_tokens,
					SUM(COALESCE(cache_creation_input_tokens, 0)) as cache_creation_input_tokens,
					SUM(COALESCE(output_tokens, 0)) as output_tokens
				FROM requests r
				WHERE ${whereClause}`,
				[NO_ACCOUNT_ID, ...queryParams],
			);

			// Time series query
			const timeSeries = await adapter.query<{
				ts: number;
				model?: string;
				requests: number;
				tokens: number;
				cost_usd: number;
				success_rate: number;
				error_rate: number;
				cache_hit_rate: number;
				avg_response_time: number;
				avg_tokens_per_second: number | null;
			}>(
				`SELECT
					(timestamp / ?) * ? as ts,
					${includeModelBreakdown ? "model," : ""}
					COUNT(*) as requests,
					SUM(COALESCE(total_tokens, 0)) as tokens,
					SUM(COALESCE(cost_usd, 0)) as cost_usd,
					SUM(CASE WHEN success = true THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as success_rate,
					SUM(CASE WHEN success = false THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as error_rate,
					SUM(COALESCE(cache_read_input_tokens, 0)) * 100.0 /
						NULLIF(SUM(COALESCE(input_tokens, 0) + COALESCE(cache_read_input_tokens, 0) + COALESCE(cache_creation_input_tokens, 0)), 0) as cache_hit_rate,
					AVG(response_time_ms) as avg_response_time,
					AVG(output_tokens_per_second) as avg_tokens_per_second
				FROM requests r
				WHERE ${whereClause} ${includeModelBreakdown ? "AND model IS NOT NULL" : ""}
				GROUP BY ts${includeModelBreakdown ? ", model" : ""}
				ORDER BY ts${includeModelBreakdown ? ", model" : ""}`,
				[bucket.bucketMs, bucket.bucketMs, ...queryParams],
			);

			// Model distribution
			const modelDistributionRaw = await adapter.query<{
				model: string;
				count: number;
			}>(
				`SELECT
					model,
					COUNT(*) as count
				FROM requests r
				WHERE ${whereClause} AND model IS NOT NULL
				GROUP BY model
				ORDER BY count DESC
				LIMIT 10`,
				queryParams,
			);

			const modelDistribution = modelDistributionRaw.map((row) => ({
				model: row.model,
				count: row.count || 0,
			}));

			// Account performance
			const accountPerformanceRaw = await adapter.query<{
				name: string;
				requests: number;
				success_rate: number;
			}>(
				`SELECT
					COALESCE(a.name, ?) as name,
					COUNT(r.id) as requests,
					SUM(CASE WHEN r.success = true THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.id), 0) as success_rate
				FROM requests r
				LEFT JOIN accounts a ON a.id = r.account_used
				WHERE ${whereClause}
				GROUP BY 1
				HAVING COUNT(*) > 0
				ORDER BY requests DESC
				LIMIT 10`,
				[NO_ACCOUNT_ID, ...queryParams],
			);

			const accountPerformance = accountPerformanceRaw.map((row) => ({
				name: row.name,
				requests: row.requests || 0,
				successRate: row.success_rate || 0,
			}));

			// Cost by model
			const costByModelRaw = await adapter.query<{
				model: string;
				cost_usd: number;
				requests: number;
				total_tokens: number;
			}>(
				`SELECT
					model,
					SUM(COALESCE(cost_usd, 0)) as cost_usd,
					COUNT(*) as requests,
					SUM(COALESCE(total_tokens, 0)) as total_tokens
				FROM requests r
				WHERE ${whereClause} AND COALESCE(cost_usd, 0) > 0 AND model IS NOT NULL
				GROUP BY model
				ORDER BY cost_usd DESC
				LIMIT 10`,
				queryParams,
			);

			const costByModel = costByModelRaw.map((row) => ({
				model: row.model,
				costUsd: row.cost_usd || 0,
				requests: row.requests || 0,
				totalTokens: row.total_tokens || 0,
			}));

			// API key performance
			const apiKeyPerformanceRaw = await adapter.query<{
				name: string;
				requests: number;
				success_rate: number;
			}>(
				`SELECT
					api_key_name as name,
					COUNT(*) as requests,
					SUM(CASE WHEN success = true THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as success_rate
				FROM requests r
				WHERE ${whereClause} AND api_key_id IS NOT NULL
				GROUP BY api_key_id, api_key_name
				HAVING COUNT(*) > 0
				ORDER BY requests DESC
				LIMIT 10`,
				queryParams,
			);

			const apiKeyPerformance = apiKeyPerformanceRaw.map((row) => ({
				id: row.name,
				name: row.name,
				requests: row.requests || 0,
				successRate: row.success_rate || 0,
			}));

			// Model performance metrics
			const modelPerfData = await adapter.query<{
				model: string;
				avg_response_time: number;
				max_response_time: number;
				total_requests: number;
				error_count: number;
				error_rate: number;
				avg_tokens_per_second: number | null;
				p95_response_time: number | null;
				min_tokens_per_second: number | null;
				max_tokens_per_second: number | null;
			}>(
				`WITH filtered AS (
					SELECT
						model,
						response_time_ms,
						output_tokens_per_second,
						success
					FROM requests r
					WHERE ${whereClause}
						AND model IS NOT NULL
						AND response_time_ms IS NOT NULL
				),
				ranked AS (
					SELECT
						model,
						response_time_ms,
						output_tokens_per_second,
						success,
						PERCENT_RANK() OVER (
							PARTITION BY model
							ORDER BY response_time_ms
						) AS pr
					FROM filtered
				)
				SELECT
					model,
					AVG(response_time_ms) as avg_response_time,
					MAX(response_time_ms) as max_response_time,
					COUNT(*) as total_requests,
					SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as error_count,
					SUM(CASE WHEN success = false THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as error_rate,
					AVG(output_tokens_per_second) as avg_tokens_per_second,
					MIN(CASE WHEN pr >= 0.95 THEN response_time_ms END) as p95_response_time,
					MIN(CASE WHEN output_tokens_per_second > 0 THEN output_tokens_per_second ELSE NULL END) as min_tokens_per_second,
					MAX(CASE WHEN output_tokens_per_second > 0 THEN output_tokens_per_second ELSE NULL END) as max_tokens_per_second
				FROM ranked
				GROUP BY model
				ORDER BY total_requests DESC
				LIMIT 10`,
				queryParams,
			);

			const modelPerformance = modelPerfData.map((modelData) => ({
				model: modelData.model,
				avgResponseTime: modelData.avg_response_time || 0,
				p95ResponseTime:
					modelData.p95_response_time ||
					modelData.max_response_time ||
					modelData.avg_response_time ||
					0,
				errorRate: modelData.error_rate || 0,
				avgTokensPerSecond: modelData.avg_tokens_per_second || null,
				minTokensPerSecond: modelData.min_tokens_per_second || null,
				maxTokensPerSecond: modelData.max_tokens_per_second || null,
			}));

			// Transform timeSeries data
			let transformedTimeSeries = timeSeries.map((point) => ({
				ts: point.ts,
				...(point.model && { model: point.model }),
				requests: point.requests || 0,
				tokens: point.tokens || 0,
				costUsd: point.cost_usd || 0,
				successRate: point.success_rate || 0,
				errorRate: point.error_rate || 0,
				cacheHitRate: point.cache_hit_rate || 0,
				avgResponseTime: point.avg_response_time || 0,
				avgTokensPerSecond: point.avg_tokens_per_second || null,
			}));

			// Apply cumulative transformation if requested
			if (isCumulative && !includeModelBreakdown) {
				let runningRequests = 0;
				let runningTokens = 0;
				let runningCostUsd = 0;

				transformedTimeSeries = transformedTimeSeries.map((point) => {
					runningRequests += point.requests;
					runningTokens += point.tokens;
					runningCostUsd += point.costUsd;

					return {
						...point,
						requests: runningRequests,
						tokens: runningTokens,
						costUsd: runningCostUsd,
						// Keep rates as-is (not cumulative)
					};
				});
			} else if (isCumulative && includeModelBreakdown) {
				// For per-model cumulative, track running totals per model
				const runningTotals: Record<
					string,
					{ requests: number; tokens: number; costUsd: number }
				> = {};

				transformedTimeSeries = transformedTimeSeries.map((point) => {
					if (point.model) {
						if (!runningTotals[point.model]) {
							runningTotals[point.model] = {
								requests: 0,
								tokens: 0,
								costUsd: 0,
							};
						}
						runningTotals[point.model].requests += point.requests;
						runningTotals[point.model].tokens += point.tokens;
						runningTotals[point.model].costUsd += point.costUsd;

						return {
							...point,
							requests: runningTotals[point.model].requests,
							tokens: runningTotals[point.model].tokens,
							costUsd: runningTotals[point.model].costUsd,
						};
					}
					return point;
				});
			}

			const response: AnalyticsResponse = {
				meta: {
					range,
					bucket: bucket.displayName,
					cumulative: isCumulative,
				},
				totals: {
					requests: consolidatedResult?.total_requests || 0,
					successRate: consolidatedResult?.success_rate || 0,
					activeAccounts: consolidatedResult?.active_accounts || 0,
					avgResponseTime: consolidatedResult?.avg_response_time || 0,
					totalTokens: consolidatedResult?.total_tokens || 0,
					totalCostUsd: consolidatedResult?.total_cost_usd || 0,
					avgTokensPerSecond: consolidatedResult?.avg_tokens_per_second || null,
				},
				timeSeries: transformedTimeSeries,
				tokenBreakdown: {
					inputTokens: consolidatedResult?.input_tokens || 0,
					cacheReadInputTokens:
						consolidatedResult?.cache_read_input_tokens || 0,
					cacheCreationInputTokens:
						consolidatedResult?.cache_creation_input_tokens || 0,
					outputTokens: consolidatedResult?.output_tokens || 0,
				},
				modelDistribution,
				accountPerformance,
				apiKeyPerformance,
				costByModel,
				modelPerformance,
			};

			return jsonResponse(response);
		} catch (error) {
			log.error("Analytics error:", error);
			return errorResponse(
				InternalServerError("Failed to fetch analytics data"),
			);
		}
	};
}

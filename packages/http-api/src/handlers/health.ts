import type { Config } from "@better-ccflare/config";
import type { DatabaseOperations } from "@better-ccflare/database";
import { jsonResponse } from "@better-ccflare/http-common";
import type { HealthResponse } from "../types";

/**
 * Create a health check handler
 */
export function createHealthHandler(dbOps: DatabaseOperations, config: Config) {
	return async (): Promise<Response> => {
		const accounts = await dbOps.getAllAccounts();

		const response: HealthResponse = {
			status: "ok",
			accounts: accounts.length,
			timestamp: new Date().toISOString(),
			strategy: config.getStrategy(),
		};

		return jsonResponse(response);
	};
}

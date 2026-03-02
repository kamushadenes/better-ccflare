import { buildUpsertSql } from "../sql-utils";
import { BaseRepository } from "./base.repository";

export interface AgentPreference {
	agentId: string;
	model: string;
	updatedAt: number;
}

export class AgentPreferenceRepository extends BaseRepository<AgentPreference> {
	/**
	 * Get model preference for a specific agent
	 */
	async getPreference(agentId: string): Promise<{ model: string } | null> {
		const row = await this.get<{ model: string }>(
			`SELECT model FROM agent_preferences WHERE agent_id = ?`,
			[agentId],
		);
		return row;
	}

	/**
	 * Get all agent preferences
	 */
	async getAllPreferences(): Promise<
		Array<{ agent_id: string; model: string }>
	> {
		return this.query<{ agent_id: string; model: string }>(
			`SELECT agent_id, model FROM agent_preferences`,
		);
	}

	/**
	 * Set model preference for an agent
	 */
	async setPreference(agentId: string, model: string): Promise<void> {
		const now = Date.now();
		if (this.db.dialect === "postgres") {
			const sql = buildUpsertSql(
				"agent_preferences",
				["agent_id", "model", "updated_at"],
				["agent_id"],
			);
			await this.db.run(sql, [agentId, model, now]);
		} else {
			await this.run(
				`INSERT OR REPLACE INTO agent_preferences (agent_id, model, updated_at) VALUES (?, ?, ?)`,
				[agentId, model, now],
			);
		}
	}

	/**
	 * Delete preference for an agent
	 */
	async deletePreference(agentId: string): Promise<boolean> {
		const changes = await this.runWithChanges(
			`DELETE FROM agent_preferences WHERE agent_id = ?`,
			[agentId],
		);
		return changes > 0;
	}

	/**
	 * Set preferences for all agents in bulk
	 */
	async setBulkPreferences(agentIds: string[], model: string): Promise<void> {
		if (agentIds.length === 0) {
			return;
		}

		const now = Date.now();
		if (this.db.dialect === "postgres") {
			for (const id of agentIds) {
				const sql = buildUpsertSql(
					"agent_preferences",
					["agent_id", "model", "updated_at"],
					["agent_id"],
				);
				await this.db.run(sql, [id, model, now]);
			}
		} else {
			const placeholders = agentIds.map(() => "(?, ?, ?)").join(", ");
			const values = agentIds.flatMap((id) => [id, model, now]);
			await this.run(
				`INSERT OR REPLACE INTO agent_preferences (agent_id, model, updated_at) VALUES ${placeholders}`,
				values,
			);
		}
	}
}

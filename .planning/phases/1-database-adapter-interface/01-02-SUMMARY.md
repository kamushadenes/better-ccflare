---
phase: 01-database-adapter-interface
plan: 02
subsystem: database
tags: [adapter, refactor, repository-pattern]
dependency_graph:
  requires: [DatabaseAdapter, SqliteAdapter, QueryParams, RunResult]
  provides: [adapter-wired-repositories, getAdapter-method]
  affects: [packages/database, packages/providers]
tech_stack:
  added: []
  patterns: [adapter-pattern, dependency-inversion]
key_files:
  created: []
  modified:
    - packages/database/src/repositories/base.repository.ts
    - packages/database/src/repositories/stats.repository.ts
    - packages/database/src/database-operations.ts
    - packages/database/src/index.ts
    - packages/providers/src/providers/bedrock/error-handler.ts
decisions:
  - "Database import changed to type-only in database-operations.ts since SqliteAdapter now handles instantiation"
  - "adapter.transaction() used directly (returns T) instead of db.transaction(fn)() two-step pattern"
  - "getDatabase() kept for backward compat; getAdapter() added for new callers needing DatabaseAdapter"
metrics:
  duration: 404s
  completed: 2026-03-01T21:55:28Z
---

# Phase 1 Plan 02: Repository & DatabaseOperations Adapter Refactoring Summary

Refactored BaseRepository, StatsRepository, and DatabaseOperations to depend on DatabaseAdapter instead of raw bun:sqlite Database, completing the adapter pattern wiring.

## What Was Done

### Task 1: BaseRepository refactored (base.repository.ts)
- Replaced `import type { Database } from "bun:sqlite"` with `import type { DatabaseAdapter, QueryParams } from "../adapter"`
- Removed local `QueryParams` type alias (now imported from adapter.ts)
- Changed constructor parameter from `Database` to `DatabaseAdapter`
- Updated method bodies to use adapter flat API:
  - `query()`: `this.db.query<R>(sql, params)` instead of `this.db.query<R, QueryParams>(sql).all(...params)`
  - `get()`: `this.db.get<R>(sql, params)` instead of `this.db.query<R, QueryParams>(sql).get(...params)`
  - `run()`: unchanged signature, adapter-compatible
  - `runWithChanges()`: `this.db.run(sql, params).changes` instead of separate result assignment
- All 7 subclass repositories (Account, Request, OAuth, Strategy, AgentPreference, ApiKey, ModelTranslation) compile unchanged

### Task 2: StatsRepository refactored + exports added
- **StatsRepository (stats.repository.ts):**
  - Replaced `Database` import with `DatabaseAdapter`
  - Changed constructor parameter from `Database` to `DatabaseAdapter`
  - Converted all 6 methods from two-step `db.query().get/all()` pattern to adapter flat API (`db.get()`, `db.query()`)
  - `getAggregatedStats()`: `this.db.get<AggregatedStats>(sql, [since])`
  - `getAccountStats()`: `this.db.query(accountStatsQuery, params)` and `this.db.query(sql, accountIds)`
  - `getActiveAccountCount()`: `this.db.get<{ count: number }>(sql)`
  - `getRecentErrors()`: `this.db.query(sql, [limit])`
  - `getTopModels()`: `this.db.query(sql, [limit])`
  - `getApiKeyStats()`: `this.db.query(sql)` and `this.db.query(sql, apiKeyIds)`
- **index.ts:**
  - Added `export type { DatabaseAdapter, QueryParams, RunResult } from "./adapter"`
  - Added `export { SqliteAdapter } from "./sqlite-adapter"`

### Task 3: DatabaseOperations refactored + external caller fixed
- **DatabaseOperations (database-operations.ts):**
  - Added `SqliteAdapter` and `DatabaseAdapter` imports
  - Added `private adapter: SqliteAdapter` field
  - Constructor creates `SqliteAdapter` first, then derives raw `Database` via `getRawDatabase()`
  - All 7 repository constructors now receive `this.adapter` instead of `this.db`
  - Added `getAdapter(): DatabaseAdapter` method alongside existing `getDatabase()`
  - `cleanupOldRequests()` uses `this.adapter.transaction()` (returns T directly, no `()()` pattern)
  - `close()`, `optimize()`, `compact()` use `this.adapter.exec()`
  - `incrementalVacuum()` uses `this.adapter.get()` and `this.adapter.exec()`
  - `runIntegrityCheck()` uses `this.adapter.get()`
  - Changed `Database` import to `import type` (no longer instantiated directly)
- **External caller (error-handler.ts):**
  - Changed `new ModelTranslationRepository(db.getDatabase())` to `new ModelTranslationRepository(db.getAdapter())`

## Commits

| Hash | Message |
|------|---------|
| ff62321 | refactor(01-02): update BaseRepository to accept DatabaseAdapter |
| 53766b3 | refactor(01-02): update StatsRepository to use DatabaseAdapter and add exports |
| b878621 | refactor(01-02): wire SqliteAdapter through DatabaseOperations and fix external caller |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Database import to type-only**
- **Found during:** Task 3
- **Issue:** After removing `new Database()` call, `Database` import was no longer used as a value, causing a Biome lint warning
- **Fix:** Changed `import { Database }` to `import type { Database }` in database-operations.ts
- **Files modified:** packages/database/src/database-operations.ts
- **Commit:** b878621

## Verification Results

- `bun run typecheck` -- zero new type errors (4 pre-existing in unrelated packages)
- `bun test packages/database/` -- 23 pass, 0 fail (migrations + adapter tests)
- `bun test packages/database/src/__tests__/sqlite-adapter.test.ts` -- 11 pass, 0 fail
- `bun run format` -- no formatting changes needed
- `bunx biome check` on modified files -- clean (0 errors, 0 warnings)
- No existing test files were modified (verified via git diff)
- Only 1 file outside packages/database/src/ was modified (error-handler.ts, single line change)

## Self-Check: PASSED

All 5 modified files exist on disk. All 3 commit hashes verified in git log.

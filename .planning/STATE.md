# Project State

## Current Phase
Phase 5 — Migration Tool & Docker. **COMPLETE.**

## Progress
Phase 1: Plan 2/2 complete
Phase 2: Plan 2/2 complete
Phase 3: Plan 2/2 complete
Phase 4: Plan 3/3 complete
Phase 5: Plan 2/2 complete

## Completed
- [x] Forked tombii/better-ccflare to kamushadenes/better-ccflare
- [x] Cloned fork with upstream remote configured
- [x] Analyzed database layer (all files in packages/database)
- [x] Created project plan, requirements, and roadmap
- [x] Phase 1 Plan 01: DatabaseAdapter interface + SqliteAdapter + 11 TDD tests
- [x] Phase 1 Plan 02: Refactored repositories + DatabaseOperations to use adapter pattern
- [x] Phase 2 Plan 01: AsyncDatabaseAdapter interface + SQL utilities (13 TDD tests)
- [x] Phase 2 Plan 02: PostgresAdapter + retry error detection (8 unit + 16 integration tests)
- [x] Phase 3 Plan 01: Async migration functions (getTableColumnsAsync, ensureSchemaAsync, runMigrationsAsync, addPerformanceIndexesAsync) + 3 unit tests
- [x] Phase 3 Plan 02: PostgreSQL migration integration tests (8 tests, gated by TEST_DATABASE_URL)
- [x] Phase 4 Plan 01: AsyncSqliteAdapter bridge + DatabaseDialect type + factory backend detection (15 TDD tests)
- [x] Phase 4 Plan 02: Async database layer with dialect-aware SQL (10 TDD tests, 72 total pass)
- [x] Phase 4 Plan 03: Caller async migration (~37 files), startup backend logging, test updates
- [x] Phase 5 Plan 01: migrateToPostgres() function + CLI --migrate-to-postgres flag (8 TDD tests)
- [x] Phase 5 Plan 02: Docker Compose postgres profile + Dockerfile DATABASE_URL docs

## Decisions Log
| Date | Decision | Rationale |
|---|---|---|
| 2026-03-01 | Dual backend (SQLite + PostgreSQL) | Backward compatibility for existing users |
| 2026-03-01 | postgres.js (porsager/postgres) | ESM-native, fast, Bun-compatible, no native bindings |
| 2026-03-01 | Database adapter pattern | Clean abstraction, testable, matches existing repository pattern |
| 2026-03-01 | `DATABASE_URL` env var for detection | Standard convention, easy to configure |
| 2026-03-01 | Pure type file for adapter.ts | Zero runtime imports prevents circular dependencies |
| 2026-03-01 | Sync interface in Phase 1 | Matches current bun:sqlite usage; async deferred to Phase 2 |
| 2026-03-01 | Database import changed to type-only | SqliteAdapter handles instantiation; Database only used as type |
| 2026-03-01 | getDatabase() kept alongside getAdapter() | Backward compat for non-repo callers using raw Database |
| 2026-03-01 | AsyncDatabaseAdapter mirrors sync shape | Consistency for consumers; Promise-wrapped returns |
| 2026-03-01 | Async transaction takes async callback | PostgreSQL queries within transactions are async |
| 2026-03-01 | Simple regex for placeholder conversion | No ? in SQL string literals in codebase; safe approach |
| 2026-03-01 | AsyncLocalStorage for transaction scoping | Routes queries to active tx without passing connection explicitly |
| 2026-03-01 | Integration tests gated by TEST_DATABASE_URL | Safe for CI without PostgreSQL; describe.skip pattern |
| 2026-03-01 | AsyncSqliteAdapter uses BEGIN/COMMIT/ROLLBACK | Explicit transaction control rather than wrapping sync transaction method |
| 2026-03-01 | Nested transaction guard via inTransaction flag | Prevents SQLite re-entrant transaction errors |
| 2026-03-01 | Dynamic import for PostgresAdapter in factory | Avoids loading postgres.js when using SQLite backend |
| 2026-03-02 | StrategyStore union return types (T or Promise T) | Backward compat with sync callers during transition |
| 2026-03-02 | DatabaseOperations.create() async static factory | Constructor cannot be async; factory pattern standard |
| 2026-03-02 | withDatabaseRetry replaces withDatabaseRetrySync | All repository methods now async |
| 2026-03-02 | Factory instancePromise dedup pattern | Prevents double initialization on concurrent calls |
| 2026-03-02 | Promise union types for strategy interfaces | Backward compat: T or Promise T allows sync and async |
| 2026-03-02 | translateBedrockError made async | Supports async getInstance and findSimilar |
| 2026-03-02 | getAccounts callback widened to accept Promise | TokenHealthService works with async dbOps.getAllAccounts |

## Performance Metrics
| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 01 | 01 | 582s | 1 | 3 |
| 01 | 02 | 404s | 3 | 5 |
| 02 | 01 | 645s | 4 | 5 |
| 02 | 02 | 562s | 3 | 5 |
| 03 | 01 | 457s | 4 | 4 |
| 03 | 02 | 190s | 1 | 1 |
| 04 | 01 | 648s | 2 | 8 |
| 04 | 02 | 798s | 9 | 13 |
| 04 | 03 | 1307s | 4 | 37 |

## Last Session
- **Stopped at:** Phase 5 complete (both plans executed)

## Blockers
None.

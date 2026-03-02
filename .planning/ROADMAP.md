# Roadmap: PostgreSQL Database Support

## Phase 1: Database Adapter Interface & SQLite Adapter
**Goal:** Extract a clean interface from the existing SQLite code without changing behavior.

**Scope:**
- Define `DatabaseAdapter` interface in `packages/database/src/adapter.ts`
- Create `SqliteAdapter` wrapping existing `bun:sqlite` logic
- Refactor `BaseRepository` to depend on `DatabaseAdapter` instead of `bun:sqlite` `Database`
- Refactor `DatabaseOperations` to use adapter internally
- Update DI container registration

**Requirements:** R1, R2
**Verification:** All existing tests pass. No behavioral change.
**Plans:** 2 plans

Plans:
- [x] 01-01-PLAN.md -- Define DatabaseAdapter interface and implement SqliteAdapter with TDD
- [x] 01-02-PLAN.md -- Refactor BaseRepository, StatsRepository, DatabaseOperations to use adapter

---

## Phase 2: PostgreSQL Adapter Implementation
**Goal:** Implement the PostgreSQL backend with full query compatibility.

**Scope:**
- Add `postgres` (porsager/postgres) dependency to `packages/database`
- Define `AsyncDatabaseAdapter` interface (async mirror of sync `DatabaseAdapter`)
- SQL utility layer: placeholder conversion (`?` → `$N`), upsert/insert-ignore builders
- Implement `PostgresAdapter` with connection pooling via postgres.js
- AsyncLocalStorage-based transaction scoping (concurrency-safe)
- PostgreSQL-specific retry logic (error codes 40001, 40P01, 55P03, connection errors)
- Connection lifecycle (pool creation, graceful shutdown)

**Requirements:** R3
**Verification:** Adapter unit tests pass with a real PostgreSQL instance.
**Plans:** 2 plans

Plans:
- [x] 02-01-PLAN.md -- AsyncDatabaseAdapter interface, SQL utilities (placeholder conversion, upsert builders)
- [x] 02-02-PLAN.md -- PostgresAdapter implementation with connection pooling, transactions, retry logic

---

## Phase 3: PostgreSQL Migrations
**Goal:** Port the migration system to support both backends.

**Scope:**
- Abstract migration runner to work with `DatabaseAdapter`
- Port all 20+ migrations to PostgreSQL-compatible DDL
- Replace `PRAGMA table_info` with `information_schema` queries
- Replace table recreation with native `ALTER TABLE DROP COLUMN`
- Migration state tracking via `_migrations` table on both backends

**Requirements:** R4
**Verification:** Fresh PostgreSQL database initializes with correct schema.
**Plans:** 2 plans

Plans:
- [x] 03-01-PLAN.md -- Async migration functions with PostgreSQL-compatible DDL
- [x] 03-02-PLAN.md -- PostgreSQL migration integration tests

---

## Phase 4: Backend Selection & Repository Updates
**Goal:** Wire everything together — auto-detect backend, update repositories.

**Scope:**
- Backend auto-detection: `DATABASE_URL` → PostgreSQL, else SQLite
- Update factory to create appropriate adapter
- Update all 8 repositories for dialect-aware upsert queries
- Integrate into DI container
- Startup logging of active backend

**Requirements:** R5, R6
**Verification:** Full application starts and serves requests on both backends.
**Plans:** 3 plans

Plans:
- [x] 04-01-PLAN.md -- AsyncSqliteAdapter bridge, dialect property, factory backend detection
- [ ] 04-02-PLAN.md -- Repository async conversion, dialect-aware SQL, DatabaseOperations async, factory async
- [ ] 04-03-PLAN.md -- Caller async migration (~24 files), startup backend logging, test updates

---

## Phase 5: Migration Tool & Docker
**Goal:** Enable users to migrate existing data and deploy with PostgreSQL.

**Scope:**
- CLI command `--migrate-to-postgres`: read SQLite, write PostgreSQL
- Handle all tables with progress reporting
- Idempotent operation (ON CONFLICT DO NOTHING on target)
- Update `docker-compose.yml` with optional PostgreSQL service
- Update `Dockerfile` dependencies

**Requirements:** R7, R8
**Verification:** Migrate a populated SQLite DB to PostgreSQL, verify data integrity.

---

## Phase 6: Testing & Documentation
**Goal:** Ensure quality and document the feature.

**Scope:**
- Run full test suite on both backends
- Add PostgreSQL-specific integration tests
- Update README, `.env.example`, CLAUDE.md
- End-to-end test: proxy request lifecycle on PostgreSQL

**Requirements:** R9, R10
**Verification:** CI passes on both backends. Documentation reviewed.

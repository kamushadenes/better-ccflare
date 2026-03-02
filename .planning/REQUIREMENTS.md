# Requirements: PostgreSQL Database Support

## Milestone 1: Full PostgreSQL Support

### R1: Database Adapter Interface
- [x] Define a `DatabaseAdapter` interface abstracting all database operations (query, run, get, exec, transaction, close)
- [x] Both SQLite and PostgreSQL backends must implement this interface
- [x] Existing `BaseRepository` must work unchanged against the adapter

### R2: SQLite Adapter
- [x] Wrap existing `bun:sqlite` logic into a `SqliteAdapter` implementing `DatabaseAdapter`
- [x] All existing tests must pass without changes when using the SQLite adapter
- [x] Preserve all PRAGMA optimizations, WAL mode, retry logic

### R3: PostgreSQL Adapter
- [x] Implement `PostgresAdapter` using `postgres` (porsager/postgres) library
- [x] Support connection via `DATABASE_URL` environment variable
- [x] Connection pooling with configurable pool size
- [x] Map all SQLite-specific SQL to PostgreSQL equivalents:
  - `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`
  - `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
  - Integer booleans → native BOOLEAN (transparent at adapter level)
  - Timestamp handling compatible with existing `Date.now()` pattern

### R4: Schema Migrations for PostgreSQL
- [x] Port all existing migrations to PostgreSQL-compatible DDL
- [x] Use `information_schema.columns` instead of `PRAGMA table_info`
- [x] Use native `ALTER TABLE DROP COLUMN` instead of table recreation
- [x] Track migration state in a `_migrations` table (same approach, both backends)

### R5: Backend Selection
- [x] Auto-detect backend: if `DATABASE_URL` env var is set → PostgreSQL; otherwise → SQLite
- [x] Inject chosen adapter via existing DI container (`packages/core-di`)
- [x] Log which backend is active at startup

### R6: Repository Compatibility
- [x] Update all repository upsert queries to use adapter-aware SQL generation
- [x] All 8 repositories must work identically on both backends
- [x] No behavioral differences observable from the application layer

### R7: SQLite-to-PostgreSQL Migration Tool
- [ ] CLI command: `bun run cli --migrate-to-postgres`
- [ ] Reads from SQLite file, writes to PostgreSQL (via `DATABASE_URL`)
- [ ] Migrates: accounts, requests, oauth tokens, API keys, strategies, agent preferences, model translations
- [ ] Idempotent — safe to re-run without duplicating data
- [ ] Reports progress and row counts

### R8: Docker Support
- [ ] Update `docker-compose.yml` to optionally include a PostgreSQL service
- [ ] Update `Dockerfile` to install `postgres` npm package
- [ ] Document PostgreSQL configuration in environment variables

### R9: Testing
- [ ] All existing tests pass on SQLite (no regression)
- [ ] Duplicate critical database tests to run against PostgreSQL
- [ ] Integration test: full proxy request lifecycle with PostgreSQL backend

### R10: Documentation
- [ ] Update README with PostgreSQL setup instructions
- [ ] Update `.env.example` with `DATABASE_URL` example
- [ ] Update CLAUDE.md database section

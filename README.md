# gov-jobs-backend

NestJS API behind **Gov Jobs Alert** — it crawls public Thai government job announcements,
serves them for search, and emails users when a new announcement matches their criteria.

## Stack

NestJS 11 · TypeScript · PostgreSQL + TypeORM · BullMQ (PostgreSQL backend) · JWT auth · Resend

## Getting started

```bash
cp .env.example .env         # local defaults point at the docker-compose services
docker compose up -d         # Postgres on 5433 (no Redis needed — see Queue below)
npm install
npm run build                # required before any migration command (see below)
npm run migration:run
npm run seed:run             # reference taxonomies + their English labels
npm run start:local
```

- API: <http://localhost:3001/api/v1>
- Swagger: <http://localhost:3001/api-docs> (non-production only)
- Health: <http://localhost:3001/healthcheck> (outside the prefix and unversioned)

## Commands

```bash
npm run start:local          # NODE_ENV=local, watch mode
npm run start:dev            # NODE_ENV=development, loads .env.development.local
npm run build                # nest build -> dist/
npm run typecheck            # tsc --noEmit
npm run lint                 # biome check
npm run lint:fix             # biome check --write
npm test                     # jest, unit specs in src/
npm run test:e2e

npm run migration:generate --name=<Name>   # diff entities against the live DB
npm run migration:create   --name=<Name>   # empty migration
npm run migration:run
npm run migration:revert
npm run seed:run
```

**The TypeORM datasource glob follows whichever tree is executing** — `dist/**/*.js` when
running compiled output, `src/**/*.ts` under ts-jest — keyed off the config file's own
extension. Loading entities from `dist/` while the caller imported the TypeScript class
registers two classes for one table and TypeORM reports "No metadata for X was found";
that is why the e2e suite can boot `AppModule` directly.

Migrations and the seed still run from `dist/`, so `npm run build` comes first — the
scripts above already chain it.

## Architecture

Three layers, deliberately separated:

- **`src/models/<domain>/`** — TypeORM entities (`entities/*.entity.ts`) and repositories
  (`*.repository.ts`), registered once in `model.module.ts`, which is `@Global()`. Any
  feature module can inject a repository without re-importing anything. Entities extend
  `BaseEntity` (uuid pk + `created_at` / `updated_at` / `deleted_at`).
- **`src/modules/<feature>/`** — controllers, services, DTOs. These never declare
  repositories; they inject the ones `ModelModule` exports.
- **`src/shared/`** — cross-cutting infrastructure: `database/` (datasource, migrations,
  seeds), `dto/`, `utils/`, `interceptors/`, `filters/`, `enums/`, `interfaces/`.

### Request pipeline

- Global prefix `/api` with URI versioning, so routes live at `/api/v1/...`.
  `GET /healthcheck` is excluded from both.
- `ValidationPipe` is global with `whitelist: true, transform: true` — every DTO uses
  `class-validator`, and unknown fields are stripped rather than trusted.
- `ResponseFormatInterceptor` envelopes every response as `{ status, message, data }`, and
  passes `meta` straight through when a handler returns a `PaginatedResponse`. Handlers
  return payloads, never `res.json(...)`.
- `GlobalExceptionFilter` renders `{ status: "error", statusCode, message }` and logs the
  stack of anything that is not an `HttpException` instead of leaking it.
- `ThrottlerGuard` is applied globally; `@SkipThrottle()` opts a route out.

### Shared utilities

Anything used in more than one module belongs in `src/shared/utils`:

- `paginate(queryBuilder, query, sortable)` — the one pagination path. `sortable` is a
  required allow-list mapping an API sort key to a SQL expression; a raw `sortBy` is never
  interpolated into `ORDER BY`.
- `resolveJobStatus(job, today)` and `jobStatusSqlExpression(alias)` — one definition of
  UPCOMING / OPEN / CLOSED, in TypeScript and in SQL.
- `getLocalDateString()` / `parseBangkokTimestamp()` — the source publishes naive dates, so
  everything is resolved against `Asia/Bangkok`.

## API

| Endpoint | Notes |
| --- | --- |
| `GET /api/v1/jobs` | Search and filter. `q`, `jobType[]`, `jobCategory[]`, `education[]`, `province[]`, `provinceStrict`, `status`, `salaryMin`, `salaryMax`, `page`, `limit`, `sortBy`, `order`. |
| `GET /api/v1/jobs/:id` | One announcement with attachments, `sourceUrl` and `applyUrl`. |
| `GET /api/v1/reference` | Taxonomy labels (TH/EN) for the filter UI. Not in the original spec, but no filter can render without it. |

Three filter rules are decisions, not defaults, and the e2e suite pins each one:

- **An announcement with no province is nationwide, not unknown**, so it is returned by
  every province filter and carries `isNationwide: true` for the card to label. 10 of the
  51 announcements in the crawler fixture are like this — 20% of the corpus — so
  `provinceStrict=true` exists for callers who want only the named provinces.
- **Salary is a range overlap with nullable bounds.** `salary_max >= :min AND salary_min
  <= :max` alone would compare `NULL` and silently drop every announcement that never
  published a salary; the explicit `IS NULL` arms keep them visible instead.
- **`sortBy` is an allow-list**, mapped to SQL expressions in `JOB_SORTABLE_COLUMNS`. An
  unknown key is a 400, never string interpolation into `ORDER BY`. Ordering is
  `NULLS LAST` in both directions, so unpublished salaries never lead the page.

## Data source

Job data comes from the **public** OCSC JSON API — no authentication, no staff-only
endpoint, no HTML scraping. Endpoints, the full field mapping and the behaviours that shape
the schema are documented in [`docs/ocsc-source.md`](docs/ocsc-source.md). Captured
responses live in `test/fixtures/` and are what the parser tests run against; tests never
hit the network.

Two rules that the schema encodes:

1. `(source, external_id)` is unique, so a second source can never collide with OCSC — and
   `content_hash` means an unchanged announcement is neither rewritten nor re-matched.
2. A `JobAlert` has a `match_from` timestamp and only matches jobs first seen at or after
   it, so a new alert never emails the entire back catalogue. The
   `(job_alert_id, job_id)` unique constraint is the dedup backstop underneath that.

## Crawler

`JobSourceCrawler` is the seam; `OcscCrawler` is the only implementation today. A crawl is
one HTTP request — the list endpoint returns every currently-listed announcement in full,
and the detail endpoint adds nothing but view counters (verified, see `docs/ocsc-source.md`).

```
fetch -> normalise -> validate -> hash -> insert/update -> report changed ids
```

Four properties the e2e suite pins:

- **A malformed announcement is skipped, not fatal.** `crawl()` returns what it could
  normalise plus a `rejected` list; only an unusable *source* throws, and that is caught and
  written to the `CrawlerRun` row. The API never goes down because the portal did.
- **`content_hash` decides everything downstream.** Re-crawling identical data writes only
  `last_seen_at`, reports `unchangedJobs`, and returns an empty `changedJobIds` — so step 9's
  alert matching is never handed a job that did not move. The hash is SHA-256 over an
  explicitly **sorted** field list, excluding the view counters, which change on every
  request.
- **`first_seen_at` never moves.** Alerts match on it, so touching it on a re-crawl would
  re-notify the entire back catalogue.
- **One run per source at a time**, enforced by a partial unique index
  (`crawler_run (source) WHERE status = 'RUNNING'`) rather than a check-then-insert, because
  an external scheduler firing while the previous crawl is still going is routine. A run
  still RUNNING after 30 minutes is treated as dead and released, so a crashed process
  cannot block every future crawl.

An empty 2xx body is treated as a failure rather than as "no results": OCSC answers
`204 No Content` for some malformed queries, and accepting that silently would mark a run
SUCCESS with zero announcements — indistinguishable from every job closing at once.

### Triggering

```bash
curl -X POST -H "x-internal-api-key: $INTERNAL_API_KEY" \
  http://localhost:3001/api/v1/internal/crawler/run
```

Returns 200 with the summary even when the crawl failed (the run row carries the error);
409 means one was already in flight. In deployment `.github/workflows/crawl.yml` calls it on
a schedule — see Deployment. Locally, `CRAWLER_SCHEDULER_ENABLED=true` runs it in-process
every `OCSC_CRAWL_INTERVAL_MINUTES` instead.

## Queue and cache

**BullMQ runs on PostgreSQL, not Redis.** BullMQ 6 ships a first-class PostgreSQL backend
that runs the same `Queue` / `Worker` / `QueueEvents` API over `LISTEN`/`NOTIFY`, keeping
its tables in a separate `bullmq` schema (auto-migrated, invisible to TypeORM's schema
diff). Select it once at bootstrap with
`setDefaultBackendFactory(createPostgresBackend)`.

The reason is arithmetic, not preference. At BullMQ's defaults — `drainDelay: 5`,
`stalledInterval: 30000` — a single **idle** worker issues roughly

    (60 / 5) × 60 × 24 × 30   = 518,400  blocking reads
  +      2    × 60 × 24 × 30   =  86,400  stalled checks
                                 -------
                                 604,800  commands per month

against Upstash's free allowance of 500,000. One worker doing nothing exceeds the whole
tier; three queues is ~3.6×. Postgres has no per-command price and is push-based rather
than polled.

Two constraints this imposes:

- The connection must be **session** mode. Transaction pooling (Supabase port 6543) drops
  `LISTEN`/`NOTIFY` and workers silently never wake. Use the session pooler (5432).
- PostgreSQL >= 13 (14+ recommended).

Redis remains only as an optional **cache**, through Upstash's REST API (`@upstash/redis`)
— no TCP socket to hold, and cache traffic stays well inside the free tier. With no
credentials configured the cache falls back to an in-process Map, so local development and
CI need no network service.

## Deployment

Render (API) · Supabase (Postgres, also the queue) · Upstash (cache, optional) · Resend (email).

Render's free web service sleeps when idle, so an in-process cron cannot be relied on
there: leave `CRAWLER_SCHEDULER_ENABLED=false` and drive crawls from an external scheduler
that calls the authenticated internal endpoint (which also wakes the instance).
`OCSC_CRAWL_INTERVAL_MINUTES` stays the knob either way.

Supabase gotchas, all three of which will bite once:

1. The direct host `db.<ref>.supabase.co` publishes **no A record** — it is IPv6-only, so
   Node's `dns.lookup` returns `ENOTFOUND` on any IPv4-only host. Use the pooler host.
2. The database is always named `postgres`, never the project name.
3. Session pooler (5432), not transaction pooler (6543) — see above.

## Known gaps

- `src/shared/database/migrations/*` is generated by TypeORM and then hand-patched for two
  things it cannot express: `CREATE EXTENSION` (uuid-ossp, pg_trgm) and the two trigram
  indexes (`gin_trgm_ops` has no decorator equivalent). Everything else — including the GIN
  indexes on the `int[]` columns — is generated. After regenerating, re-apply those patches
  and confirm `migration:generate` reports *"No changes in database schema were found"*.
- Postgres ends up with three structurally identical `*_source_enum` types, one per table
  that stores a `JobSource`. A single shared type is what you would write by hand, but
  TypeORM re-emits `CREATE TYPE` once per entity for it and every generated migration then
  needs editing. Adding a source means regenerating, which updates all three.
- `@nestjs/bullmq` has not been checked against a process-wide
  `setDefaultBackendFactory(createPostgresBackend)` — raw BullMQ is verified against
  Supabase (queue ready, job round-trip, retry with backoff), but the Nest wrapper is not.
  It should work, since the `connection` value the module forwards is ours, but confirm it
  first thing in step 10 rather than assuming (see nestjs/bull#2903).
- A full crawl takes ~18s cold and ~7s warm against Supabase in Singapore, because
  `persist()` does a lookup, a write and an attachment reconcile per announcement — roughly
  350 round trips at ~46ms each. Fine at 51 announcements and the obvious thing to batch if
  a second source multiplies it.
- `CrawlSummary.changedJobIds` returns the whole array (51 UUIDs, ~1.9 kB today). Step 10
  should enqueue one matching job per id rather than inherit this shape as a single BullMQ
  payload — decide it deliberately there.
- `.github/workflows/crawl.yml` is the production crawl trigger but **nothing runs it yet**:
  the backend has no git repo (only `gov-jobs-frontend` does), and it needs the `API_BASE_URL`
  and `INTERNAL_API_KEY` repository secrets once it has one.
- `raw_payload` keeps the source entry verbatim. Measured at 1.4 kB/row after jsonb
  compression — ~7 MB at 5,000 announcements, against Supabase free's 256 MB. No action
  needed; recheck if a second source multiplies the row count.

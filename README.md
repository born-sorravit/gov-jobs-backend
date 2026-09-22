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

## Authentication

Access tokens are short-lived JWTs. **Refresh tokens are opaque random strings, not JWTs** —
only their SHA-256 hash is stored, so a database leak grants no sessions, revocation is a row
update rather than a blocklist, and there is no second signing secret. (The earlier config
had `refreshTtlDays: 30` alongside a string `expiresIn`; feeding a bare number to
`jsonwebtoken` means *seconds*, so that would have produced a 30-second "30-day" token.)

`JwtAuthGuard` is registered **globally** and switched off per route with `@Public()`, not
the reverse: a route added later without a guard is a 401, not an unnoticed hole. The
existing public surface — `/jobs`, `/jobs/:id`, `/reference`, `/healthcheck` and the
internal crawler endpoint — carries `@Public()` explicitly, and the pre-existing e2e suites
are what prove none was missed.

Three decisions the tests pin:

- **Login cannot be used to enumerate accounts.** An unknown email and a wrong password
  return the identical message, and an unknown email is still compared against a real dummy
  bcrypt hash so the two cost the same time.
- **Registration lets the unique index decide.** A `23505` becomes a 409; a prior `findOne`
  would race and surface a 500 on simultaneous sign-ups.
- **Rotation has a grace window.** A refresh token is single-use, but a browser firing
  several requests at a just-expired access token sends the same one more than once, and the
  frontend cannot serialise that in general — it runs on serverless instances sharing no
  memory. A token revoked *by rotation* stays usable for `REFRESH_ROTATION_GRACE_MS`
  (default 15s); one revoked by **logout** never is, and a replay past the window is still
  rejected. Verified both ways: 5 parallel requests against an expired token all succeed and
  the session survives; a replay after the window is a 401.

Credential endpoints are throttled to `AUTH_THROTTLE_LIMIT` (default 10/minute) against the
global 120 — reasonable for browsing jobs, absurd for password attempts.

**Not built yet:** email verification. `isVerified` exists as a column and is always false;
the flow needs the email module in step 11.

## Saved jobs

`GET /saved-jobs`, `GET /saved-jobs/ids`, `POST|DELETE /saved-jobs/:jobId`.

- **`/saved-jobs/ids` is declared before the `:jobId` routes.** Nest matches in declaration
  order and `ids` is a perfectly valid string for a uuid param, so the reverse order makes
  that endpoint unreachable — a 400 on every call. It exists so a public, cacheable
  `GET /jobs` never has to vary per user: the client marks its own cards from this set.
- **POST and DELETE are both idempotent**, and both return 200. Saving something already
  saved satisfies the user's intent, and a 409 or 404 would make an optimistic toggle
  flicker back on a double click.
- **Removal is a hard delete, deliberately.** `SavedJob` inherits `deletedAt` from
  `BaseEntity`, but `uq_saved_job_user_job` carries no `WHERE deleted_at IS NULL` — so a
  soft delete would leave the row in place and re-saving that job would fail on the unique
  index *permanently*. The e2e suite saves, unsaves and saves again for exactly this reason.

## Job alerts and matching

CRUD plus `POST /job-alerts/:id/pause|resume`. An alert another user owns is a **404**, not a
403 — a 403 would confirm the id exists.

Matching runs at the end of each crawl, over exactly the announcements that were inserted or
materially changed, never the whole table. One query per announcement decides which alerts it
satisfies:

- **Keywords are ORed and matched as substrings** against the position title *and* the agency
  name. Thai has no word boundaries, so this is the only thing that works — the spec's own
  example is `นักวิชาการคอมพิวเตอร์` matching `นักวิชาการคอมพิวเตอร์ปฏิบัติการ`. Agency is
  included because keywords are the only free-text an alert has. `%` and `_` are escaped, or a
  keyword containing one would silently match far more than the user typed.
- **Filters are OR within a dimension, AND across them**, and an empty array is no constraint.
- **A null position type matches every type filter**, like an unlisted province is nationwide.
  This needs an explicit null guard: `ARRAY[NULL]` makes an overlap `NULL` rather than false,
  which would collapse the whole condition and silently drop the alert.
- **`match_from` is the floor.** Set on create and moved forward on **resume**; `PATCH` never
  touches it, so editing can never be used to replay the archive. A brand-new alert therefore
  reports nothing about announcements discovered before it existed.
- **`uq_job_alert_match_alert_job` is the duplicate-notification guarantee.** The insert uses
  `orIgnore()`, so re-running a crawl over the same announcements creates nothing.

Verified against the live pipeline: an alert created today matched **0** of the 48 announcements
already in the archive (the floor working), then 2 after their content changed, then **1** more
on a re-crawl where two of the three pairs already existed — no duplicates.

`CrawlerRun.alertMatches` and the crawl summary carry the count, so the feature is visible
without querying the database by hand.

**Matching only records.** `JobAlertMatch.notifiedAt` stays null; sending the email is step 11.

## Email notifications

`EmailProvider` is the seam; `EmailService` depends on it and never on a vendor. The provider
is chosen once from `MAIL_PROVIDER` — `resend` or `console`. Console is the default and writes
the message to the log, so a fresh checkout runs the whole alert pipeline end to end without
an API key and without mailing anyone by accident.

Every send writes an `EmailLog` row **before** it goes out and updates it afterwards, so a
provider that hangs mid-send still leaves a trace. A failure re-throws, BullMQ retries, and
the row is the audit trail.

### Delivery is at-least-once, deliberately

Matches are loaded while still unnotified, the email is sent, and only then are they marked.
A crash between the send and the mark can therefore duplicate one email. The alternative —
marking first — silently loses a notification when a send fails, and a missed job alert is
the exact failure this product exists to prevent.

This narrows what "prevent duplicate notifications" means: **one `JobAlertMatch` row per
(alert, announcement), guaranteed by the unique constraint**, and a send that is idempotent
except across that crash window. The processor also re-reads the matches and stops if they
are already notified, so an ordinary BullMQ retry after a successful send sends nothing.

### Frequencies

- **IMMEDIATE** — the matching processor queues one email per new match, keyed
  `email--<matchId>`.
- **DAILY / WEEKLY** — matches sit unnotified until a digest run collects them into one email
  per alert, keyed `digest--<alertId>--<periodKey>` where the period is the Bangkok date or
  the ISO week. A cron that fires twice in one period still produces one digest.

Digests are triggered by `POST /internal/digests/run?frequency=DAILY|WEEKLY`, driven by the
same external scheduler as the crawl and for the same reason: the free-tier instance sleeps,
and a daily digest that only fires when someone happens to be browsing is not a daily digest.
`.github/workflows/crawl.yml` calls it after each crawl, with the weekly variant on Mondays.

`JobAlert.lastSentAt` is written on every send, immediate or digest.

### Job ids cannot contain `:`

BullMQ reserves the colon for its own key structure and **rejects any custom job id
containing one as soon as a queue `prefix` is configured** — which ours is. It throws
`Custom Id cannot contain :`, which surfaced as matches being recorded while their emails
were never queued. All deterministic ids use `--` as the separator.

### The email itself

Contains exactly what requirement 10 lists — title, agency, position type, education,
province, application period, salary — plus the **source URL**, which is the primary action.
The subject leads with the position title rather than the alert name: it is the one line that
survives truncation in a notification, and the position is what the reader is deciding about.
`<html lang="th">` and a Thai-first font stack, because no email client ships the site's font.

**Resend's free tier** sends from a verified domain or the shared `onboarding@resend.dev`,
which in most configurations can only deliver to the account owner's own address. Point
`MAIL_FROM` at a verified domain before expecting delivery to arbitrary recipients;
`MAIL_PROVIDER=console` is the test path until then.

## Admin

`GET /admin/overview | crawler-runs | users | alerts | email-logs`, all behind
`@Roles(UserRole.ADMIN)` and **read-only**. The spec asks for visibility, not controls, and
every action that might belong here already exists as an internal endpoint the scheduler
drives.

**`RolesGuard` re-reads the role from the database** rather than trusting the token. An access
token lives 15 minutes and carries the role it was minted with, so without this a promotion
would not take effect until it rotated — and, far worse, a *demoted* admin would keep access
for up to 15 minutes. One extra query on a handful of routes closes that. The e2e suite
promotes and demotes a live token to prove both directions.

There is deliberately **no API for changing roles**. An endpoint that grants admin is the
single most valuable thing to attack on the whole service, and the number of administrators
is small enough that a command is the right shape:

```bash
npm run admin:promote --email=someone@example.com
npm run admin:promote --email=someone@example.com --demote=true
```

It fails loudly on an unknown address rather than reporting success for a typo, and is
idempotent. Like `seed:run` it builds first and runs from `dist/`, so entity identity matches
the datasource globs.

The overview runs its dozen counts in one `Promise.all` — sequentially they would be a dozen
round trips at ~46ms each, which is visible on the one page where everything is a number. It
also reports **consecutive failures since the last success**: one failed crawl is a blip from
a public portal that occasionally 500s, several in a row is the thing worth surfacing.

`/admin/users` returns an explicit DTO rather than the entity. It is a page that shows
personal data by necessity, so what it shows is a decision rather than whatever happens to be
on the row.

## Queue and cache

**BullMQ runs on PostgreSQL, not Redis.** BullMQ 6 ships a first-class PostgreSQL backend
that runs the same `Queue` / `Worker` / `QueueEvents` API over `LISTEN`/`NOTIFY`, keeping its
tables in a separate `bullmq` schema (auto-migrated, invisible to TypeORM's schema diff).

The reason is arithmetic, not preference. At BullMQ's defaults — `drainDelay: 5`,
`stalledInterval: 30000` — a single **idle** worker issues roughly 605,000 Redis commands a
month against Upstash's free allowance of 500,000. One worker doing nothing exceeds the whole
tier; three queues is ~3.6×.

`setDefaultBackendFactory(createPostgresBackend)` is a **module-scope statement** in
`queue.module.ts`, not something `main.ts` calls: the e2e suites boot `AppModule` directly and
never run `main.ts`, so importing the module has to be what installs it. If it were missed,
BullMQ would silently construct a Redis backend and try to reach localhost:6379 — which the
existing e2e suites would fail on, loudly.

### Queues

| Queue | Producer | Processor |
| --- | --- | --- |
| `ocsc-crawler` | registered; the HTTP trigger still runs synchronously (below) | — |
| `job-matching` | the crawler, one job per changed announcement | `JobMatchingProcessor` |
| `email-notification` | `NotificationDispatchService` (immediate + digests) | `EmailNotificationProcessor` |

**Matching is one queued job per announcement**, with a `jobId` of
`match:<id>:<contentHash>` — so a retried crawl re-importing the same announcements enqueues
nothing new, and a failure retries one announcement rather than the whole crawl. The
`(alert, job)` unique constraint is still the last line of defence.

Workers write their results back with a raw `UPDATE … SET alert_matches = alert_matches + n`.
Dozens finish concurrently against one `CrawlerRun` row, and a read-then-save would lose most
of them. The crawl summary therefore reports `matchingEnqueued`, not a match count — that
number is not knowable when the crawl returns.

**A consequence worth knowing:** `POST /internal/crawler/run` still answers synchronously, so
the external scheduler gets a real verdict — but SUCCESS now means "imported, matching
queued". On Render's free tier the instance can sleep right after responding, leaving queued
jobs until the next request wakes it. Matching completes soon after, not necessarily within
the crawl.

### Cache

Redis remains only as an optional **cache**, through Upstash's REST API (`@upstash/redis`) —
no TCP socket to hold, and cache traffic stays well inside the free tier. With either
credential missing it degrades to an in-process Map, so local development and CI need no
network service and nothing branches on whether a cache exists.

Its one consumer is `GET /reference`: static between crawls and requested by every page. The
crawler drops the entry when it re-syncs the taxonomies. Measured 340ms cold, 53ms warm.

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

## Tests

```bash
npm test          # 88 unit specs, no database, no network
npm run test:e2e  # 163 specs against a real Postgres
```

Unit specs cover the pure logic: the OCSC normaliser against the captured fixture, job
status, pagination, the response envelope, email rendering, ISO week keys, the credential
throttle's metadata. E2e covers everything whose behaviour is SQL or a queue — array overlap,
the nationwide wildcard, the `match_from` floor, rotation grace, the role gate, at-least-once
delivery.

Three things worth knowing about how they run:

- **E2e share one database and one queue.** Assertions must be scoped to the suite's own rows;
  a global `COUNT(*)` will be inflated by whatever another file left behind. Announcement ids
  are remapped into a reserved range (`900000000+`) so a cleanup never deletes real crawled
  data — a lesson from doing exactly that once.
- **A failing job sits in `delayed` between retries**, so waiting for the queue to drain never
  succeeds in a failure test. Those tests poll for the observable effect — a `FAILED`
  `EmailLog` row, a `notifiedAt` that became non-null — instead.
- **Two tests have been seen to flake**, both timing-related in the shared environment:
  `auth › never forgives a token revoked by signing out` and
  `email queue › queues an immediate alert's match right away`. Each passed on every rerun and
  neither has been root-caused.

`auth-throttle.spec.ts` asserts the decorator's metadata rather than firing requests: the
limit is per-IP and process-wide, so a test that proved it would also throttle every other
test in the file.

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
- A full crawl takes ~18s cold and ~7s warm against Supabase in Singapore, because
  `persist()` does a lookup, a write and an attachment reconcile per announcement — roughly
  350 round trips at ~46ms each. Fine at 51 announcements and the obvious thing to batch if
  a second source multiplies it.
- `.github/workflows/crawl.yml` is the production crawl trigger but **nothing runs it yet**:
  the backend has no git repo (only `gov-jobs-frontend` does), and it needs the `API_BASE_URL`
  and `INTERNAL_API_KEY` repository secrets once it has one.
- `raw_payload` keeps the source entry verbatim. Measured at 1.4 kB/row after jsonb
  compression — ~7 MB at 5,000 announcements, against Supabase free's 256 MB. No action
  needed; recheck if a second source multiplies the row count.

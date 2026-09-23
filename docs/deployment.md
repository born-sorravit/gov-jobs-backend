# Deployment

Everything here fits in free tiers. Two repositories, five managed services:

```
GitHub Actions (cron)  ──POST /internal/*──┐
                                           v
Vercel (gov-jobs-frontend) ──HTTPS──> Render (gov-jobs-backend)
   sin1, Next 16                         singapore, Node 24
                                           │
                        ┌──────────────────┼──────────────────┐
                        v                  v                  v
                 Supabase Postgres   Upstash Redis        Resend
                 ap-southeast-1      (REST cache)         (email)
                 data + BullMQ queue
```

There is no Redis in the queue path. BullMQ runs on its **PostgreSQL backend** over the same
`DATABASE_URL`, because a single idle BullMQ worker on Redis issues ~605k commands/month
against Upstash's 500k free allowance. Upstash is used only as a cache, over its REST API.

---

## Order of operations

The two URLs are circular — Render needs Vercel's URL for CORS, Vercel needs Render's URL for
the API — so Render is deployed twice: once to get a URL, once with the real values.

1. **Supabase** → `DATABASE_URL`
2. **Upstash** → cache credentials
3. **Resend** → API key + verified sender domain
4. **Render** → deploy the blueprint, note the service URL
5. **Vercel** → deploy with Render's URL
6. **Render again** → set `CORS_ORIGINS` / `PUBLIC_WEB_URL` to Vercel's URL
7. **GitHub secrets** → so the crawl workflow can run
8. **Promote the first admin**

---

## 1. Supabase

Create a project in **ap-southeast-1 (Singapore)** so it sits next to Render.

From *Connect*, copy the **Session pooler** URI. Three traps, all of which have bitten this
project already:

- The direct host `db.<ref>.supabase.co` is **IPv6-only**. Node's `dns.lookup` returns
  `ENOTFOUND` from any IPv4-only host. The pooler host resolves to IPv4 and works everywhere.
- The database is always named `postgres`, never your project name.
- Use the **session** pooler on port **5432**, not the transaction pooler on 6543.
  Transaction pooling silently drops `LISTEN`/`NOTIFY`, and BullMQ's Postgres backend depends
  on it — the workers would simply never wake, with no error anywhere.

No schema setup is needed: `migration:run` executes on every boot, and BullMQ creates its own
tables in the `bullmq` schema on first use.

## 2. Upstash

Create a Redis database and copy the **REST** credentials (`UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`) — the HTTP API, which is what `@upstash/redis` speaks.

Both are optional. Unless **both** are set the app falls back to an in-process `Map`, which is
correct behaviour, just colder after each restart.

## 3. Resend

Add and **verify a sending domain** — this is a DNS step outside this repository, and until it
completes every send fails. `MAIL_FROM` must be on the verified domain.

`onboarding@resend.dev` works without verification but only delivers to your own Resend
account address, so it is fine for a smoke test and useless for real users.

## 4. Render

**New → Blueprint**, pointed at `gov-jobs-backend`. [`render.yaml`](../render.yaml) declares
the service and prompts for every `sync: false` variable.

| Prompted | Value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** URI |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | from Upstash (or leave blank) |
| `RESEND_API_KEY` | from Resend |
| `MAIL_FROM` | e.g. `Gov Jobs Alert <alerts@yourdomain.com>` |
| `MAIL_REPLY_TO` | optional |
| `INTERNAL_API_KEY` | pick a long random string — **the same string goes into GitHub secrets** |
| `CORS_ORIGINS` / `PUBLIC_WEB_URL` | placeholder for now; step 6 fixes them |

`JWT_SECRET` uses `generateValue: true`, so Render generates it and nothing else needs to know
it. `INTERNAL_API_KEY` deliberately does not, because GitHub Actions has to send the identical
value.

`PORT` is injected by Render; `main.ts` reads it and binds `0.0.0.0`. The start command runs
`migration:run` before `node dist/main`, and migrations are idempotent, so running them on
every cold start is safe.

Note the service URL, e.g. `https://gov-jobs-backend.onrender.com`.

## 5. Vercel

Import `gov-jobs-frontend`. `vercel.json` in the frontend repo pins
functions to `sin1`, next to Render and Supabase — the Next middleware refreshes sessions
against the API on requests, so a US default region would add a round trip across the Pacific
to page loads.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://<render-service>.onrender.com/api/v1` — **include `/api/v1`** |
| `NEXT_PUBLIC_SITE_URL` | `https://<project>.vercel.app` |

Both are `NEXT_PUBLIC_*` and therefore **inlined at build time**. Changing either requires a
redeploy, not just a restart.

## 6. Back to Render

Now that Vercel's URL exists, set it in Render and let the service redeploy:

- `CORS_ORIGINS` = `https://<project>.vercel.app` (comma-separated if more than one)
- `PUBLIC_WEB_URL` = the same URL

`PUBLIC_WEB_URL` is what alert emails link to. Leave it wrong and every email points at
`localhost` — nothing errors, the links just do not work for anyone.

## 7. GitHub secrets

In `gov-jobs-backend` → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `API_BASE_URL` | `https://<render-service>.onrender.com` — **no** `/api/v1` suffix |
| `INTERNAL_API_KEY` | identical to the value set in Render |

The two differ on purpose: [`crawl.yml`](../.github/workflows/crawl.yml) appends
`/healthcheck` and `/api/v1/internal/...` itself.

Then run the workflow once from the Actions tab (`workflow_dispatch`) rather than waiting two
hours for the schedule.

## 8. First admin

There is deliberately no API for changing roles — an endpoint that grants admin is the single
most valuable thing to attack on the whole service. Register through the UI, then from a
checkout with `DATABASE_URL` pointing at production:

```bash
npm run admin:promote --email=you@example.com
npm run admin:promote --email=you@example.com --demote=true
```

`RolesGuard` re-reads the role from the database on every admin request, so it takes effect
immediately — no need to sign out and back in.

---

## Smoke test

```bash
API=https://<render-service>.onrender.com

curl -s "$API/healthcheck"                       # {"database":"up"}
curl -s "$API/api/v1/jobs?limit=1" | head -c 200 # public search
curl -s -X POST -H "x-internal-api-key: $KEY" \
     "$API/api/v1/internal/crawler/run-all" | jq '.data | {succeeded, failed, skipped}'
```

`run-all` is what the scheduled workflow calls. It answers 200 whatever the sources did, so
read the body: `succeeded: 0` is the only result that means the crawl is broken. One source
failing is normal — MDES answers 403 to bursts and recovers on its own.

Then open `https://<project>.vercel.app/admin` — *Crawler health* should show the run you just
triggered.

---

## Free-tier behaviour worth knowing

**Render sleeps after ~15 minutes idle.** This is why `CRAWLER_SCHEDULER_ENABLED=false`: an
in-process timer would stop firing. `crawl.yml` is the real scheduler, and its request also
wakes the instance — the workflow pings `/healthcheck` with retries first because a cold start
takes up to a minute and the crawl request would otherwise time out.

**Email is sent by in-process workers, inside that awake window.** `POST /internal/crawler/run-all`
returns once matching is *enqueued*, not once email is sent. In practice this is fine:
enqueue→sent latency is sub-second, and the retry ladder (`attempts: 5`, exponential from 5s)
tops out around 75 seconds — all far inside the ~15 minutes the instance stays up after the
workflow's last request. The failure mode to watch for is *Awaiting email* on `/admin` staying
above zero across consecutive runs; that means the queue is not draining before the instance
sleeps, and the fix is a more frequent cron, not a code change.

**Supabase free projects pause after ~7 days of inactivity** and need a manual unpause. The
two-hourly crawl keeps it warm, so this only bites if Actions stop.

**GitHub disables scheduled workflows after 60 days of repository inactivity.** A commit, or
re-enabling from the Actions tab, restores them. If crawls quietly stop, check this first.

**Upstash free allows 500k commands/month.** Cache use is far below it. Do not be tempted to
move BullMQ onto it — see the arithmetic at the top of this document.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `JwtStrategy requires a secret or key` | `JWT_SECRET` empty. Locally: `NODE_ENV=development` selects `.env.development.local`; use `npm run start:local` to read `.env` instead |
| Workers never run, queue grows | Transaction pooler (6543) instead of session pooler (5432) — `LISTEN`/`NOTIFY` is dropped |
| `ENOTFOUND db.<ref>.supabase.co` | Direct host is IPv6-only; use the pooler host |
| CORS errors in the browser | `CORS_ORIGINS` still a placeholder (step 6) |
| Emails link to `localhost` | `PUBLIC_WEB_URL` still a placeholder (step 6) |
| Every send fails | Resend sending domain not verified, or `MAIL_FROM` off that domain |
| `/admin` returns 404 while signed in | Account is not `ADMIN` — by design, so the page's existence is not disclosed. See step 8 |
| Crawl workflow red, API healthy | Endpoint returns 200 with `status: FAILED` when the source is unreachable; the workflow greps the body. Check the run row on `/admin` |

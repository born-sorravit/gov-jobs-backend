# OCSC Source Reference

How `gov-jobs-backend` reads public government job announcements from the OCSC Job Portal.

Portal (human): <https://job.ocsc.go.th/portal>
API base (public, unauthenticated): `https://jobapp.ocsc.go.th/jobapi`

The portal is a Vite/React SPA — its HTML contains no job data. All data is served by the
public JSON API the SPA itself calls. We consume that API instead of scraping HTML:
it is the same publicly accessible information, but stable and already normalised.

No authentication, no cookies, no staff-only endpoint is used.
`https://job.ocsc.go.th/robots.txt` disallows only `Bingbot`; no crawl-delay is declared.
We still crawl at a low, configurable interval (`CRAWLER_INTERVAL_MINUTES`).

## Endpoints

| Purpose | Method + path | Notes |
| --- | --- | --- |
| Job list | `GET /portal/jobs` | Returns a **full JSON array** (~51 items). Optional `query`, `education`, `department` params. **No pagination** — `page`/`limit` are ignored. |
| Job detail | `GET /portal/jobs/{id}` | Verified byte-identical to the matching list element except the `webView`/`mobileView` counters. **We do not call it** — one list request is a complete crawl. |
| Jobs by department | `GET /portal/departments/{id}/jobs` | Not used. |
| Departments | `GET /portal/departments?type={1,2,3}` | Agency directory. |
| Provinces | `GET /provinces` | Lookup, 77 rows. |
| Education levels | `GET /educationlevels` | Lookup, 12 rows. |
| Position types | `GET /jobtypes` | Lookup, 12 rows (ทั่วไป / วิชาการ / อำนวยการ / …). |
| Job categories | `GET /jobcategories` | Lookup, 3 rows (ข้าราชการพลเรือน / พนักงานราชการ / อื่น ๆ). |
| Position levels | `GET /joblevels` | Lookup, 13 rows. |
| Selection methods | `GET /jobselections` | Lookup, 3 rows. |
| Transfer conditions | `GET /jobconditions` | Lookup, 4 rows. |

Captured snapshots of every endpoint above live in `test/fixtures/ocsc-*.fixture.json`
and are the input for the parser / normalisation / matching tests. Live data drifts —
tests must never hit the network.

## Field mapping — OCSC payload → `job` table

| OCSC field | Column | Notes |
| --- | --- | --- |
| `id` | `external_id` | Unique **per source**. `(source, external_id)` is the composite unique key. |
| `position` | `title` | |
| `department` | `agency` | |
| `ministry` | `ministry` | |
| `departmentId` | `agency_external_id` | |
| `seal` | `agency_seal_url` | |
| `jobCategoryId` / `jobCategoryOther` | `job_category_id` / `job_category_other` | ข้าราชการพลเรือน vs พนักงานราชการ. |
| `jobTypeId` / `jobTypeOther` | `job_type_id` / `job_type_other` | Position type — this is what the `jobType` API filter means. |
| `jobLevelId` / `jobLevelOther` | `job_level_id` / `job_level_other` | |
| `jobSelectionId` / `jobSelectionOther` | `job_selection_id` / `job_selection_other` | |
| `jobConditionId` / `jobConditionOther` | `job_condition_id` / `job_condition_other` | |
| `provinceIds` | `province_ids int[]` | **Array, frequently empty** (10 of 51 in the snapshot). Empty = nationwide / unspecified. |
| `educationLevelIds` | `education_level_ids int[]` | Array. |
| `educationLevelOther` | `education_level_other` | |
| `civilJobEducation` ‖ `employeeJobSpecification` | `education_requirements` | Civil-servant postings fill the `civilJob*` block; พนักงานราชการ postings fill `employeeJob*`. |
| `civilJobDescription` ‖ `employeeJobDescription` | `description` | |
| `civilJobKnowledge` ‖ `employeeJobKnowledge1`+`2` | `knowledge` | |
| `civilJobSkill` ‖ `employeeJobSkill1`+`2` | `skill` | |
| `employeeJobCompetency1`+`2` | `competency` | |
| `employeeJobCriteria` | `criteria` | |
| `salaryMin` / `salaryMax` | `salary_min` / `salary_max` | |
| `positionAmount` | `position_amount` | |
| `applicationStart` / `applicationEnd` | `application_start` / `application_end` | `date`, no timezone. |
| `examDate` / `interviewDate` | `exam_date` / `interview_date` | |
| `createDate` | `published_at` | Naive local timestamp. |
| *(derived)* | `source_url` | `https://job.ocsc.go.th/portal/jobs/{id}` — the **human** page, so users can verify the announcement. Never the `jobapi` URL. |
| `url` | `apply_url` | External application site (e.g. `m-society.thaijobjob.com`). Separate from `source_url`. |
| `fileName` | → `job_attachment` row | The announcement PDF, e.g. `https://job.ocsc.go.th/upload2/job-10957.pdf`. 0 or 1 per job. |
| *(whole payload)* | `raw_payload jsonb` | Preserved verbatim so nothing is lost when the mapping changes. |
| *(derived)* | `content_hash` | SHA-256 over the normalised fields **excluding** view counters. Unchanged hash ⇒ no write, no re-match. |

Ignored: `address` (always null in the snapshot), `webView`, `webShare`, `mobileView`,
`mobileShare` (churn on every request), `numApplicants`, `numCandidates`, `numEmployees`,
`candidateStart`/`candidateEnd`, and all `*Print` fields (Buddhist-era display strings we
re-render ourselves).

## Behaviours that shape the design

1. **The list only contains currently-listed announcements.** Jobs disappear from it once
   they close. Our database is therefore an **accumulating archive**: we never delete a job
   that falls off the list, we only stop seeing it. `CLOSED` jobs exist locally only because
   we crawled them while they were open.
2. **Dates are naive** (`2026-10-01`, `2026-09-21T15:06:09`) with no timezone. Status is
   computed against `Asia/Bangkok`, otherwise `UPCOMING`/`OPEN`/`CLOSED` flip at the wrong hour.
3. **`content_hash` gates everything downstream.** A crawl that sees unchanged data writes
   nothing, reports `updatedJobs: 0`, and enqueues no matching work.
4. **Alerts only match jobs discovered after the alert's `match_from`**, otherwise the first
   user to create an alert is emailed about the entire back catalogue. The
   `(job_alert_id, job_id)` unique constraint is a dedup backstop, not this rule.
5. **All job content is Thai.** EN/TH switching in the frontend is UI chrome only — titles,
   agencies and requirements stay in the source language.

## Adding another source

`JobSourceCrawler` is the seam:

```ts
interface JobSourceCrawler {
	readonly source: JobSource;
	crawl(): Promise<CrawlResult>;
	/** Refreshes the taxonomy labels this source's ids point at; 0 when it has none. */
	syncReference(): Promise<number>;
}
```

`crawl()` resolves with whatever it could normalise and reports the rest in `rejected` — one
malformed announcement must never fail a run. It throws only when the *source* is unusable,
which is what marks the run FAILED.

`CrawlerRegistry` maps `JobSource` to the implementation. `CrawlerService` resolves through
it rather than branching on `source`, which is what keeps matching, notifications and the
document pipeline from ever learning that a new portal exists.

The recipe:

1. Add the `JobSource` enum value, and widen all three `*_source_enum` types in one
   migration (`MultiSourceEnums1790079845524` is the pattern).
2. Write the crawler, returning `NormalizedJob`s. A source with no taxonomy endpoints
   returns 0 from `syncReference()` and leaves the `*_id` fields null — they are OCSC's
   integer ids into `reference_item`, and nothing downstream requires them. `DolCrawler` is
   the worked example for an HTML source: `dol.parser.ts` is pure and tested against captured
   pages, `dol.crawler.ts` only fetches. Reuse `computeContentHash` from
   `crawler/normalization.ts` — a second hash implementation that drifts would re-notify
   every user about the entire back catalogue.
   If the source mixes openings with results and notices, reuse `isRecruitmentAnnouncement`
   from `crawler/recruitment-title.ts` and report the rest as `rejected`; the note there says
   why the list is positive rather than negative. Widen the list there, not per source.
   Free-text fields are canonicalised for you — `normalizeJobText` runs before the content
   hash — but call it from the parser as the existing ones do, or the hash will describe text
   that is not what gets stored.
3. Add the class to `CRAWLER_PROVIDERS` in `crawler.module.ts`. That is the only wiring.
4. It is now reachable at `POST /internal/crawler/run/:source` and included in `run-all`.

`(source, external_id)` keeps ids from colliding. Nothing else in the pipeline changes —
that is the property `crawler.registry.spec.ts` and the `run-all` tests exist to hold.

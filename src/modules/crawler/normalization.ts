import { NormalizedJob } from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { normalizeThaiText } from "@/shared/utils/thai-text.util";
import { createHash } from "node:crypto";

/**
 * An announcement that cannot be turned into a usable job.
 *
 * Every crawler throws this per announcement and records the result in `CrawlResult.rejected`
 * — one malformed entry must never fail a whole run.
 */
export class JobValidationError extends Error {}

/**
 * The source itself is unusable — network failure, non-2xx, empty body, markup that no
 * longer contains any announcements.
 *
 * Distinct from `JobValidationError`, which is about one announcement: this is what marks a
 * whole run FAILED, because continuing would import nothing and report success.
 */
export class SourceUnavailableError extends Error {}

/**
 * Fields the content hash is computed over, and the only ones that mean "this announcement
 * changed". Deliberately excludes view counters (they move on every request), `lastSeenAt`,
 * and anything we derive rather than receive.
 *
 * Shared by every source: two hash implementations that drift apart would re-notify users
 * about the entire back catalogue the first time they disagreed.
 */
const HASHED_FIELDS = [
	"title",
	"agency",
	"ministry",
	"agencyExternalId",
	"agencySealUrl",
	"jobCategoryId",
	"jobCategoryOther",
	"jobTypeId",
	"jobTypeOther",
	"jobLevelId",
	"jobLevelOther",
	"jobSelectionId",
	"jobSelectionOther",
	"jobConditionId",
	"jobConditionOther",
	"provinceIds",
	"educationLevelIds",
	"educationLevelOther",
	"description",
	"educationRequirements",
	"knowledge",
	"skill",
	"competency",
	"criteria",
	"salaryMin",
	"salaryMax",
	"positionAmount",
	"applicationStart",
	"applicationEnd",
	"examDate",
	"interviewDate",
	"applyUrl",
] as const;

/**
 * SHA-256 over a canonical serialisation of the fields above.
 *
 * Keys are sorted explicitly rather than relying on object insertion order: the day someone
 * reorders a field in a normaliser, insertion-order hashing would report every announcement
 * as changed and re-enqueue matching for all of them.
 */
export const computeContentHash = (
	job: Omit<NormalizedJob, "contentHash">
): string => {
	const canonical = [...HASHED_FIELDS]
		.sort()
		.map((field) => [field, (job as Record<string, unknown>)[field] ?? null]);

	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

/** Every free-text field a reader or a keyword ever sees. */
const TEXT_FIELDS = [
	"title",
	"agency",
	"ministry",
	"jobCategoryOther",
	"jobTypeOther",
	"jobLevelOther",
	"jobSelectionOther",
	"jobConditionOther",
	"educationLevelOther",
	"description",
	"educationRequirements",
	"knowledge",
	"skill",
	"competency",
	"criteria",
] as const;

/**
 * Canonicalises every free-text field, and the attachment names with them.
 *
 * Applied here rather than in each parser so a new source cannot forget it: the matching
 * engine compares a user's keyword against `title` and `agency` with ILIKE, and Thai portals
 * spell `ำ` two different ways — MDES uses both on one page. Two spellings that look
 * identical and compare unequal is a missed alert, which is the one failure this product
 * exists to prevent.
 *
 * Runs before `computeContentHash`, so the hash describes the text actually stored.
 */
export const normalizeJobText = <T extends Omit<NormalizedJob, "contentHash">>(
	job: T
): T => {
	const normalized = { ...job } as Record<string, unknown>;

	for (const field of TEXT_FIELDS) {
		const value = normalized[field];
		if (typeof value === "string") {
			normalized[field] = normalizeThaiText(value);
		}
	}

	normalized.attachments = job.attachments.map((attachment) => ({
		...attachment,
		name: normalizeThaiText(attachment.name),
	}));

	return normalized as T;
};

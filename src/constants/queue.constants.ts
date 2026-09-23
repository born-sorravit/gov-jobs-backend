import { createHash } from "node:crypto";

/** Queue names. Kept here so producers and processors cannot drift apart on a typo. */
export const QUEUE_OCSC_CRAWLER = "ocsc-crawler";
export const QUEUE_JOB_MATCHING = "job-matching";
export const QUEUE_EMAIL_NOTIFICATION = "email-notification";
export const QUEUE_DOCUMENT_PROCESSING = "document-processing";

/**
 * Shared retry policy.
 *
 * Exponential from 5s, so a source or SMTP hiccup is ridden out without hammering: roughly
 * 5s, 10s, 20s, 40s, 80s.
 */
export const DEFAULT_JOB_OPTIONS = {
	attempts: 5,
	backoff: { type: "exponential" as const, delay: 5000 },
	// Keep a short tail for debugging; without a cap these tables grow without bound.
	removeOnComplete: { age: 24 * 3600, count: 500 },
	removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

export interface MatchJobPayload {
	jobId: string;
	/** Attributed back to the crawl that produced it, so the run's totals stay meaningful. */
	crawlerRunId: string | null;
}

export interface DocumentJobPayload {
	attachmentId: string;
}

export interface EmailJobPayload {
	/** Immediate is one announcement; a digest is everything pending for one alert. */
	kind: "immediate" | "digest";
	jobAlertId: string;
	matchIds: string[];
}

/**
 * Deterministic job ids, which are what actually prevent a duplicate email.
 *
 * `--` rather than `:` as the separator: BullMQ reserves the colon for its own key structure
 * and rejects a custom id containing one as soon as a queue `prefix` is configured — which
 * ours is. The failure is a thrown "Custom Id cannot contain :", not a silent fallback.
 *
 * Immediate keys on the match, which is unique per (alert, announcement). A digest cannot —
 * its contents grow as matches accrue — so it keys on the alert and the period, and a cron
 * that fires twice in one day still enqueues one digest.
 */
/**
 * Keyed on the whole set of matches an email covers, not on one of them.
 *
 * One email can now cover several matches — the positions of a single announcement — so the
 * id has to describe the set, or a group would collide with a differently-sized group for the
 * same alert. Hashed because the set is unbounded and because BullMQ rejects a custom id
 * containing `:` once a queue prefix is configured, which announcement URLs are full of.
 *
 * The dedup property is unchanged: dispatching the same pending matches twice produces the
 * same id and the second add is dropped, while a match that arrives later forms a different
 * set and gets its own email.
 */
export const immediateEmailJobId = (matchIds: string[]): string =>
	`email--${createHash("sha256")
		.update([...matchIds].sort().join(","))
		.digest("hex")
		.slice(0, 32)}`;
export const digestEmailJobId = (alertId: string, periodKey: string): string =>
	`digest--${alertId}--${periodKey}`;

/**
 * Document work keys on the attachment alone.
 *
 * The bytes behind a URL are treated as immutable — sources publish a new file rather than
 * editing one in place — so a crawl that re-imports the same attachment enqueues nothing new.
 * Re-reading a document on purpose means resetting its status, not minting a second job.
 */
export const documentJobId = (attachmentId: string): string =>
	`document--${attachmentId}`;

/** Matching keys on the announcement and its content, so a retried crawl re-enqueues nothing. */
export const matchJobId = (jobId: string, contentHash: string): string =>
	`match--${jobId}--${contentHash}`;

/**
 * Matching triggered by a document finishing, rather than by a crawl.
 *
 * Keyed on the attachment, not on the announcement's content hash: extracted text is not part
 * of that hash, so a job re-matched after its PDF was read would otherwise collide with the
 * id the crawl already used — and a completed BullMQ job with that id makes the new one a
 * silent duplicate.
 */
export const matchAfterDocumentJobId = (attachmentId: string): string =>
	`match-doc--${attachmentId}`;

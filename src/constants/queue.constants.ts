/** Queue names. Kept here so producers and processors cannot drift apart on a typo. */
export const QUEUE_OCSC_CRAWLER = "ocsc-crawler";
export const QUEUE_JOB_MATCHING = "job-matching";
export const QUEUE_EMAIL_NOTIFICATION = "email-notification";

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
export const immediateEmailJobId = (matchId: string): string => `email--${matchId}`;
export const digestEmailJobId = (alertId: string, periodKey: string): string =>
	`digest--${alertId}--${periodKey}`;

/** Matching keys on the announcement and its content, so a retried crawl re-enqueues nothing. */
export const matchJobId = (jobId: string, contentHash: string): string =>
	`match--${jobId}--${contentHash}`;

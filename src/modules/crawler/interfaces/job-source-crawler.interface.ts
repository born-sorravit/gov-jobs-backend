import { JobSource } from "@/shared/enums/job-source.enum";

/**
 * A normalised announcement, independent of which portal it came from.
 *
 * This is the contract every crawler produces and the persistence layer consumes, so adding
 * a source means writing one class — nothing downstream changes.
 */
export interface NormalizedJob {
	source: JobSource;
	externalId: string;
	title: string;
	agency: string;
	ministry: string | null;
	agencyExternalId: number | null;
	agencySealUrl: string | null;
	jobCategoryId: number | null;
	jobCategoryOther: string | null;
	jobTypeId: number | null;
	jobTypeOther: string | null;
	jobLevelId: number | null;
	jobLevelOther: string | null;
	jobSelectionId: number | null;
	jobSelectionOther: string | null;
	jobConditionId: number | null;
	jobConditionOther: string | null;
	provinceIds: number[];
	educationLevelIds: number[];
	educationLevelOther: string | null;
	description: string | null;
	educationRequirements: string | null;
	knowledge: string | null;
	skill: string | null;
	competency: string | null;
	criteria: string | null;
	salaryMin: number | null;
	salaryMax: number | null;
	positionAmount: number | null;
	applicationStart: string | null;
	applicationEnd: string | null;
	examDate: string | null;
	interviewDate: string | null;
	publishedAt: Date | null;
	sourceUrl: string;
	applyUrl: string | null;
	contentHash: string;
	rawPayload: Record<string, unknown>;
	attachments: NormalizedAttachment[];
}

export interface NormalizedAttachment {
	name: string;
	url: string;
	type: "ANNOUNCEMENT_PDF" | "OTHER";
}

/** An announcement the source published but we could not use, with the reason. */
export interface RejectedJob {
	externalId: string | null;
	reason: string;
}

export interface CrawlResult {
	jobs: NormalizedJob[];
	rejected: RejectedJob[];
	/** How many entries the source returned, before validation. */
	totalFound: number;
}

/**
 * The seam for additional sources — university jobs, local government, and so on.
 *
 * `crawl()` must resolve with whatever it could normalise and report the rest in
 * `rejected`; a single malformed announcement is never allowed to fail a whole run. It
 * throws only when the *source* is unusable (network failure, non-2xx, empty body), which
 * is what marks the run FAILED.
 */
export interface JobSourceCrawler {
	readonly source: JobSource;
	crawl(): Promise<CrawlResult>;
	/** Refreshes the taxonomy labels this source's ids point at. */
	syncReference(): Promise<number>;
}

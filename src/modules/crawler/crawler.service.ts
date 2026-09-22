import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { CrawlerRunRepository } from "@/models/crawler/crawler-run.repository";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { JobAttachmentRepository } from "@/models/jobs/job-attachment.repository";
import { JobRepository } from "@/models/jobs/job.repository";
import {
	JobSourceCrawler,
	NormalizedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	MatchJobPayload,
	QUEUE_JOB_MATCHING,
	matchJobId,
} from "@/constants/queue.constants";
import { ReferenceService } from "@/modules/reference/reference.service";
import { OcscCrawler } from "@/modules/crawler/ocsc/ocsc.crawler";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { JobSource } from "@/shared/enums/job-source.enum";
import { InjectQueue } from "@nestjs/bullmq";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { DeepPartial, In, LessThan } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

export interface CrawlSummary {
	runId: string;
	source: JobSource;
	status: CrawlerRunStatus;
	totalFound: number;
	newJobs: number;
	updatedJobs: number;
	unchangedJobs: number;
	skippedJobs: number;
	/**
	 * Announcements handed to the matching queue. The resulting match count is not known
	 * when the crawl returns — workers write it to `CrawlerRun.alertMatches` as they finish.
	 */
	matchingEnqueued: number;
	durationMs: number;
	errorMessage: string | null;
	/** Ids of announcements that were inserted or materially changed by this run. */
	changedJobIds: string[];
}

/** A run still marked RUNNING after this long is assumed dead and released. */
const STALE_RUN_MINUTES = 30;

@Injectable()
export class CrawlerService {
	private readonly logger = new Logger(CrawlerService.name);
	private readonly crawlers: Map<JobSource, JobSourceCrawler>;

	constructor(
		private readonly crawlerRunRepository: CrawlerRunRepository,
		private readonly jobRepository: JobRepository,
		private readonly jobAttachmentRepository: JobAttachmentRepository,
		@InjectQueue(QUEUE_JOB_MATCHING)
		private readonly matchingQueue: Queue<MatchJobPayload>,
		private readonly referenceService: ReferenceService,
		ocscCrawler: OcscCrawler
	) {
		this.crawlers = new Map([[ocscCrawler.source, ocscCrawler as JobSourceCrawler]]);
	}

	/**
	 * Runs one source end to end and always resolves: a failure is recorded on the
	 * `CrawlerRun` row and returned, never thrown past this point. Requirement 8 — a crawler
	 * failure must not take the API down with it.
	 *
	 * The one exception is `ConflictException` for an overlapping run, which the caller
	 * turns into a 409 because it means "nothing happened", not "something broke".
	 */
	async run(source: JobSource, trigger: string): Promise<CrawlSummary> {
		const crawler = this.crawlers.get(source);
		if (!crawler) {
			throw new ConflictException(`No crawler registered for source ${source}`);
		}

		await this.releaseStaleRuns(source);
		const run = await this.startRun(source, trigger);
		const startedAt = Date.now();

		try {
			// Taxonomies first: a job referencing a brand-new province id is useless until the
			// label exists, and this is cheap.
			await crawler.syncReference();
			// The taxonomies just changed underneath the cached copy.
			await this.referenceService.invalidate(source);

			const { jobs, rejected, totalFound } = await crawler.crawl();
			const { newJobs, updatedJobs, unchangedJobs, changedJobIds } =
				await this.persist(jobs);

			// Handed to the queue rather than run here: a failure then retries one announcement
			// instead of the whole crawl, and the request is not held open for the work.
			const matchingEnqueued = await this.enqueueMatching(changedJobIds, run.id);

			const summary: CrawlSummary = {
				runId: run.id,
				source,
				status: CrawlerRunStatus.SUCCESS,
				totalFound,
				newJobs,
				updatedJobs,
				unchangedJobs,
				skippedJobs: rejected.length,
				matchingEnqueued,
				durationMs: Date.now() - startedAt,
				errorMessage: null,
				changedJobIds,
			};

			await this.crawlerRunRepository.update(run.id, {
				status: CrawlerRunStatus.SUCCESS,
				finishedAt: new Date(),
				totalFound,
				newJobs,
				updatedJobs,
				unchangedJobs,
				skippedJobs: rejected.length,
			});

			this.logger.log(
				`${source} crawl done in ${summary.durationMs}ms: ${totalFound} found, ` +
					`${newJobs} new, ${updatedJobs} updated, ${unchangedJobs} unchanged, ${rejected.length} skipped, ${matchingEnqueued} queued for matching`
			);

			return summary;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logger.error(`${source} crawl failed: ${errorMessage}`);

			await this.crawlerRunRepository.update(run.id, {
				status: CrawlerRunStatus.FAILED,
				finishedAt: new Date(),
				errorMessage,
			});

			return {
				runId: run.id,
				source,
				status: CrawlerRunStatus.FAILED,
				totalFound: 0,
				newJobs: 0,
				updatedJobs: 0,
				unchangedJobs: 0,
				skippedJobs: 0,
				matchingEnqueued: 0,
				durationMs: Date.now() - startedAt,
				errorMessage,
				changedJobIds: [],
			};
		}
	}

	/**
	 * Claims the single active slot for this source.
	 *
	 * The uniqueness is a partial index on `(source) WHERE status = 'RUNNING'`, so two
	 * schedulers firing at once means one insert fails rather than two crawls racing.
	 */
	private async startRun(source: JobSource, trigger: string): Promise<CrawlerRun> {
		try {
			return await this.crawlerRunRepository.save(
				this.crawlerRunRepository.create({
					source,
					trigger,
					status: CrawlerRunStatus.RUNNING,
					startedAt: new Date(),
				})
			);
		} catch (error) {
			if (this.isUniqueViolation(error)) {
				throw new ConflictException(`A ${source} crawl is already running`);
			}
			throw error;
		}
	}

	/**
	 * Frees the slot after a crash. Without this a process killed mid-crawl leaves a
	 * permanent RUNNING row and every later crawl 409s forever.
	 */
	private async releaseStaleRuns(source: JobSource): Promise<void> {
		const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
		const result = await this.crawlerRunRepository.update(
			{ source, status: CrawlerRunStatus.RUNNING, startedAt: LessThan(cutoff) },
			{
				status: CrawlerRunStatus.FAILED,
				finishedAt: new Date(),
				errorMessage: `Abandoned: still RUNNING after ${STALE_RUN_MINUTES} minutes`,
			}
		);

		if (result.affected) {
			this.logger.warn(`Released ${result.affected} stale ${source} run(s)`);
		}
	}

	/**
	 * Hands each changed announcement to the matching queue.
	 *
	 * The job id is derived from the announcement and its content hash, so a retried crawl
	 * that re-imports the same announcements enqueues nothing new — BullMQ drops a duplicate
	 * id outright. The `(alert, job)` unique constraint is still the last line of defence.
	 */
	private async enqueueMatching(
		jobIds: string[],
		crawlerRunId: string
	): Promise<number> {
		if (jobIds.length === 0) return 0;

		const jobs = await this.jobRepository.find({
			where: { id: In(jobIds) },
			select: { id: true, contentHash: true },
		});

		await this.matchingQueue.addBulk(
			jobs.map((job) => ({
				name: "match",
				data: { jobId: job.id, crawlerRunId },
				opts: { jobId: matchJobId(job.id, job.contentHash) },
			}))
		);

		return jobs.length;
	}

	private async persist(jobs: NormalizedJob[]): Promise<{
		newJobs: number;
		updatedJobs: number;
		unchangedJobs: number;
		changedJobIds: string[];
	}> {
		let newJobs = 0;
		let updatedJobs = 0;
		let unchangedJobs = 0;
		const changedJobIds: string[] = [];
		const seenAt = new Date();

		for (const job of jobs) {
			const existing = await this.jobRepository.findOne({
				where: { source: job.source, externalId: job.externalId },
				select: { id: true, contentHash: true },
			});

			if (!existing) {
				const entity = this.jobRepository.create({
					...(this.toEntity(job) as DeepPartial<Job>),
					firstSeenAt: seenAt,
					lastSeenAt: seenAt,
				});
				const saved = await this.jobRepository.save(entity);
				await this.replaceAttachments(saved.id, job);
				newJobs += 1;
				changedJobIds.push(saved.id);
				continue;
			}

			if (existing.contentHash === job.contentHash) {
				// Nothing changed: touch the sighting and do not enqueue matching work.
				await this.jobRepository.update(existing.id, { lastSeenAt: seenAt });
				unchangedJobs += 1;
				continue;
			}

			await this.jobRepository.update(existing.id, {
				...this.toEntity(job),
				lastSeenAt: seenAt,
			});
			await this.replaceAttachments(existing.id, job);
			updatedJobs += 1;
			changedJobIds.push(existing.id);
		}

		return { newJobs, updatedJobs, unchangedJobs, changedJobIds };
	}

	/**
	 * Everything except `firstSeenAt`/`lastSeenAt`, which the caller owns, and attachments,
	 * which are their own rows.
	 *
	 * The cast is for `rawPayload`: TypeORM's `QueryDeepPartialEntity` recurses into object
	 * columns, so a `jsonb` typed as `Record<string, unknown>` never satisfies it even though
	 * the value is exactly what the driver wants.
	 */
	private toEntity(job: NormalizedJob): QueryDeepPartialEntity<Job> {
		const { attachments: _attachments, ...fields } = job;
		return fields as QueryDeepPartialEntity<Job>;
	}

	private async replaceAttachments(
		jobId: string,
		job: NormalizedJob
	): Promise<void> {
		const wanted = job.attachments;
		const existing = await this.jobAttachmentRepository.find({ where: { jobId } });

		const wantedUrls = new Set(wanted.map((attachment) => attachment.url));
		const staleIds = existing
			.filter((attachment) => !wantedUrls.has(attachment.url))
			.map((attachment) => attachment.id);

		if (staleIds.length > 0) {
			await this.jobAttachmentRepository.delete(staleIds);
		}

		const existingUrls = new Set(existing.map((attachment) => attachment.url));
		const toInsert = wanted.filter(
			(attachment) => !existingUrls.has(attachment.url)
		);

		if (toInsert.length > 0) {
			await this.jobAttachmentRepository.insert(
				toInsert.map((attachment) => ({
					jobId,
					name: attachment.name,
					url: attachment.url,
					type: attachment.type as JobAttachment["type"],
				}))
			);
		}
	}

	private isUniqueViolation(error: unknown): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "23505"
		);
	}
}

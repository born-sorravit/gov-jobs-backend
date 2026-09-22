import { CrawlerRunRepository } from "@/models/crawler/crawler-run.repository";
import { MatchJobPayload, QUEUE_JOB_MATCHING } from "@/constants/queue.constants";
import { AlertMatchingService } from "@/modules/job-alerts/alert-matching.service";
import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

/**
 * Matches one announcement against every active alert.
 *
 * One announcement per job rather than a whole crawl's worth in a single payload: a failure
 * then retries just that announcement, and the queue's own `jobId` deduplication does real
 * work for us.
 */
@Processor(QUEUE_JOB_MATCHING, { concurrency: 4 })
export class JobMatchingProcessor extends WorkerHost {
	private readonly logger = new Logger(JobMatchingProcessor.name);

	constructor(
		private readonly alertMatchingService: AlertMatchingService,
		private readonly crawlerRunRepository: CrawlerRunRepository,
		private readonly dispatchService: NotificationDispatchService
	) {
		super();
	}

	async process(job: Job<MatchJobPayload>): Promise<{ matches: number }> {
		const { jobId, crawlerRunId } = job.data;

		const created = await this.alertMatchingService.matchJobs([jobId]);
		const matches = created.length;

		if (matches > 0 && crawlerRunId) {
			// Recorded before the email is queued: a raw increment, not read-modify-write,
			// because dozens of these finish concurrently against the same run row. Doing it
			// after the dispatch would lose the count whenever the dispatch failed — the retry
			// re-runs `matchJobs`, which correctly finds nothing new to record.
			await this.crawlerRunRepository.increment(
				{ id: crawlerRunId },
				"alertMatches",
				matches
			);
		}

		// Only IMMEDIATE alerts are emailed here; a digest alert leaves its matches pending
		// until the digest run collects them, which is the whole difference between them.
		if (matches > 0) {
			await this.dispatchService.dispatchImmediate(created);
		}

		if (matches > 0) {
			this.logger.log(`Announcement ${jobId} matched ${matches} alert(s)`);
		}

		return { matches };
	}
}

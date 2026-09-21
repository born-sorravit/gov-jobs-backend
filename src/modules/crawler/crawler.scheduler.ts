import { CrawlerService } from "@/modules/crawler/crawler.service";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";

/**
 * In-process scheduling, off by default.
 *
 * On Render's free tier the web service sleeps when idle, so a timer here simply stops
 * firing — deployments leave `CRAWLER_SCHEDULER_ENABLED=false` and drive crawls through the
 * internal endpoint instead. It is genuinely useful for local development and for any
 * always-on host, which is why it exists at all.
 */
@Injectable()
export class CrawlerScheduler implements OnModuleInit {
	private readonly logger = new Logger(CrawlerScheduler.name);

	constructor(
		private readonly crawlerService: CrawlerService,
		private readonly configService: ConfigService,
		private readonly schedulerRegistry: SchedulerRegistry
	) {}

	onModuleInit(): void {
		const enabled = this.configService.get<boolean>(
			"crawler.schedulerEnabled",
			false
		);
		if (!enabled) {
			this.logger.log(
				"In-process crawl scheduler disabled (CRAWLER_SCHEDULER_ENABLED)"
			);
			return;
		}

		const minutes = Math.max(
			1,
			this.configService.get<number>("crawler.ocsc.crawlIntervalMinutes", 60)
		);

		const job = new CronJob(`0 */${minutes} * * * *`, () => {
			void this.crawlerService
				.run(JobSource.OCSC, "scheduler")
				// `run` already swallows crawl failures; this catches the 409 raised when a
				// previous crawl is still in flight, which is expected, not exceptional.
				.catch((error: Error) =>
					this.logger.warn(`Scheduled crawl skipped: ${error.message}`)
				);
		});

		this.schedulerRegistry.addCronJob("ocsc-crawl", job);
		job.start();
		this.logger.log(
			`In-process crawl scheduler enabled: every ${minutes} minute(s)`
		);
	}
}

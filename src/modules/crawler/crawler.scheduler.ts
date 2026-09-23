import { CrawlerService } from "@/modules/crawler/crawler.service";
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
			this.configService.get<number>("crawler.intervalMinutes", 60)
		);

		const job = new CronJob(`0 */${minutes} * * * *`, () => {
			// `runAll` rather than a hardcoded OCSC crawl: it absorbs both a crawl failure and
			// an overlapping run per source, so there is nothing left for a `.catch` here, and
			// a new source starts being scheduled the moment it is registered.
			void this.crawlerService.runAll("scheduler");
		});

		this.schedulerRegistry.addCronJob("source-crawl", job);
		job.start();
		this.logger.log(
			`In-process crawl scheduler enabled: every ${minutes} minute(s)`
		);
	}
}

import { CrawlerController } from "@/modules/crawler/crawler.controller";
import { CrawlerScheduler } from "@/modules/crawler/crawler.scheduler";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import { OcscCrawler } from "@/modules/crawler/ocsc/ocsc.crawler";
import { QUEUE_JOB_MATCHING } from "@/constants/queue.constants";
import { JobAlertsModule } from "@/modules/job-alerts/job-alerts.module";
import { ReferenceModule } from "@/modules/reference/reference.module";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

@Module({
	imports: [
		JobAlertsModule,
		ReferenceModule,
		BullModule.registerQueue({ name: QUEUE_JOB_MATCHING }),
	],
	controllers: [CrawlerController],
	providers: [CrawlerService, OcscCrawler, CrawlerScheduler],
	exports: [CrawlerService],
})
export class CrawlerModule {}

import { CrawlerController } from "@/modules/crawler/crawler.controller";
import {
	CrawlerRegistry,
	JOB_SOURCE_CRAWLERS,
} from "@/modules/crawler/crawler.registry";
import { CrawlerScheduler } from "@/modules/crawler/crawler.scheduler";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import { DolCrawler } from "@/modules/crawler/dol/dol.crawler";
import { MdesCrawler } from "@/modules/crawler/mdes/mdes.crawler";
import { JobSourceCrawler } from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { OcscCrawler } from "@/modules/crawler/ocsc/ocsc.crawler";
import {
	QUEUE_DOCUMENT_PROCESSING,
	QUEUE_JOB_MATCHING,
} from "@/constants/queue.constants";
import { JobAlertsModule } from "@/modules/job-alerts/job-alerts.module";
import { ReferenceModule } from "@/modules/reference/reference.module";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

/**
 * The one place a new source is wired in: add the crawler to `providers`, then to
 * `CRAWLER_PROVIDERS` below. Nothing in `CrawlerService`, the controller, the scheduler,
 * matching or notifications changes.
 */
const CRAWLER_PROVIDERS = [OcscCrawler, DolCrawler, MdesCrawler];

@Module({
	imports: [
		JobAlertsModule,
		ReferenceModule,
		BullModule.registerQueue(
			{ name: QUEUE_JOB_MATCHING },
			{ name: QUEUE_DOCUMENT_PROCESSING }
		),
	],
	controllers: [CrawlerController],
	providers: [
		...CRAWLER_PROVIDERS,
		{
			// Injected as a list so `CrawlerRegistry` never has to name a crawler class, and so
			// a test can substitute an arbitrary set without providing every real one. The
			// factory resolves each class through Nest, so `overrideProvider(OcscCrawler)`
			// still reaches the registry.
			provide: JOB_SOURCE_CRAWLERS,
			useFactory: (...crawlers: JobSourceCrawler[]) => crawlers,
			inject: CRAWLER_PROVIDERS,
		},
		CrawlerRegistry,
		CrawlerService,
		CrawlerScheduler,
	],
	exports: [CrawlerService, CrawlerRegistry],
})
export class CrawlerModule {}

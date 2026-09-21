import { CrawlerController } from "@/modules/crawler/crawler.controller";
import { CrawlerScheduler } from "@/modules/crawler/crawler.scheduler";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import { OcscCrawler } from "@/modules/crawler/ocsc/ocsc.crawler";
import { Module } from "@nestjs/common";

@Module({
	controllers: [CrawlerController],
	providers: [CrawlerService, OcscCrawler, CrawlerScheduler],
	exports: [CrawlerService],
})
export class CrawlerModule {}

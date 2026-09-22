import { Public } from "@/shared/decorators/public.decorator";
import { CrawlSummary, CrawlerService } from "@/modules/crawler/crawler.service";
import { JobSource } from "@/shared/enums/job-source.enum";
import {
	INTERNAL_API_KEY_HEADER,
	InternalApiKeyGuard,
} from "@/shared/guards/internal-api-key.guard";
import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";

// Guarded by InternalApiKeyGuard instead; without @Public the two schemes would
// both run and the shared-secret call would still be rejected for lacking a JWT.
@Public()
@ApiTags("internal")
@Controller("internal/crawler")
@UseGuards(InternalApiKeyGuard)
@ApiHeader({ name: INTERNAL_API_KEY_HEADER, required: true })
export class CrawlerController {
	constructor(private readonly crawlerService: CrawlerService) {}

	/**
	 * Triggered by an external scheduler (GitHub Actions cron, cron-job.org, …) because the
	 * free-tier instance sleeps and an in-process timer would not fire. The request also
	 * wakes the instance, which is half the point.
	 *
	 * Returns 200 with the run summary even when the crawl failed — the run row carries the
	 * error, and a scheduler retrying a failed crawl immediately would just hammer the
	 * source. 409 means a crawl was already in flight.
	 */
	@SkipThrottle()
	@Post("run")
	@HttpCode(200)
	@ApiOperation({ summary: "Run the OCSC crawl now" })
	run(): Promise<CrawlSummary> {
		return this.crawlerService.run(JobSource.OCSC, "internal-endpoint");
	}
}

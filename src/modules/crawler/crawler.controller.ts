import { Public } from "@/shared/decorators/public.decorator";
import {
	CrawlSummary,
	CrawlerService,
	RunAllSummary,
} from "@/modules/crawler/crawler.service";
import { JobSource } from "@/shared/enums/job-source.enum";
import {
	INTERNAL_API_KEY_HEADER,
	InternalApiKeyGuard,
} from "@/shared/guards/internal-api-key.guard";
import {
	BadRequestException,
	Controller,
	HttpCode,
	Param,
	Post,
	UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
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
	 *
	 * Still OCSC-only, and still the shape the deployed workflow greps for `"status":
	 * "SUCCESS"`. New callers should use `run/:source` or `run-all`; this stays because
	 * changing what a deployed cron calls is a separate, revertible step.
	 */
	@SkipThrottle()
	@Post("run")
	@HttpCode(200)
	@ApiOperation({ summary: "Run the OCSC crawl now (legacy alias for run/OCSC)" })
	run(): Promise<CrawlSummary> {
		return this.crawlerService.run(JobSource.OCSC, "internal-endpoint");
	}

	/**
	 * Every registered source, in sequence, isolated from one another.
	 *
	 * 200 regardless of what the individual sources did: the body carries `failed` and
	 * `skipped` counts, and a caller that wants to go red on a partial failure reads those.
	 * A non-2xx here would mean "the batch did not run", which is a different thing.
	 */
	@SkipThrottle()
	@Post("run-all")
	@HttpCode(200)
	@ApiOperation({ summary: "Run every registered source" })
	runAll(): Promise<RunAllSummary> {
		return this.crawlerService.runAll("internal-endpoint");
	}

	/**
	 * One named source.
	 *
	 * Declared after `run-all` so the literal route is matched first — Express would
	 * otherwise bind "run-all" as `:source` and answer with a 400.
	 *
	 * 400 for a string that is not a `JobSource` at all, 404 for a real source with no
	 * crawler in this build. Those are genuinely different mistakes: the first is a typo,
	 * the second is a source whose enum value has shipped ahead of its crawler.
	 */
	@SkipThrottle()
	@Post("run/:source")
	@HttpCode(200)
	@ApiOperation({ summary: "Run one source now" })
	@ApiParam({ name: "source", enum: JobSource })
	runSource(@Param("source") source: string): Promise<CrawlSummary> {
		return this.crawlerService.run(this.parseSource(source), "internal-endpoint");
	}

	/** Case-insensitive, because a cron definition is hand-written and `dol` is the obvious typo. */
	private parseSource(value: string): JobSource {
		const candidate = value.toUpperCase();
		const sources = Object.values(JobSource) as string[];

		if (!sources.includes(candidate)) {
			throw new BadRequestException(
				`Unknown source "${value}". Expected one of: ${sources.join(", ")}`
			);
		}

		return candidate as JobSource;
	}
}

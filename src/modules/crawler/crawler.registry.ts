import { JobSourceCrawler } from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

/**
 * The injection token for the crawlers this deployment can run.
 *
 * A token holding the whole set, rather than the registry naming each crawler class in its
 * constructor, is what keeps the registry itself closed to modification: adding a source
 * touches `CrawlerModule` and nothing else, and a test can substitute an arbitrary set of
 * fakes without a matching provider for every real crawler.
 */
export const JOB_SOURCE_CRAWLERS = Symbol("JOB_SOURCE_CRAWLERS");

/**
 * Resolves a `JobSource` to the crawler that can fetch it.
 *
 * This exists so that `CrawlerService` never grows a `switch (source)`. It is also the
 * honest answer to "what can we crawl right now?", which is not the same question as "what
 * values does the enum have?" — the enum is a database type and runs ahead of the code.
 */
@Injectable()
export class CrawlerRegistry {
	private readonly crawlers: ReadonlyMap<JobSource, JobSourceCrawler>;

	constructor(@Inject(JOB_SOURCE_CRAWLERS) crawlers: JobSourceCrawler[]) {
		const bySource = new Map<JobSource, JobSourceCrawler>();

		for (const crawler of crawlers) {
			// Two crawlers claiming one source is a wiring mistake that would otherwise show up
			// as one of them silently never running. Fail at boot instead.
			if (bySource.has(crawler.source)) {
				throw new Error(`Two crawlers are registered for source ${crawler.source}`);
			}
			bySource.set(crawler.source, crawler);
		}

		this.crawlers = bySource;
	}

	/**
	 * @throws NotFoundException when the source is real but has no crawler in this build —
	 * a 404, not a 409: nothing is in conflict, the thing simply does not exist here.
	 */
	get(source: JobSource): JobSourceCrawler {
		const crawler = this.crawlers.get(source);
		if (!crawler) {
			throw new NotFoundException(`No crawler is registered for source ${source}`);
		}
		return crawler;
	}

	has(source: JobSource): boolean {
		return this.crawlers.has(source);
	}

	/**
	 * Every source that can actually be crawled, in `JobSource` declaration order.
	 *
	 * Ordering off the enum rather than off provider registration keeps `run-all` stable:
	 * reordering the providers array must not silently reorder production crawls.
	 */
	sources(): JobSource[] {
		return Object.values(JobSource).filter((source) => this.crawlers.has(source));
	}
}

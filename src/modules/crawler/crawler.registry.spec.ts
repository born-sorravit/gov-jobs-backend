import { CrawlerRegistry } from "@/modules/crawler/crawler.registry";
import {
	CrawlResult,
	JobSourceCrawler,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { JobSource } from "@/shared/enums/job-source.enum";
import { NotFoundException } from "@nestjs/common";

const crawlerFor = (source: JobSource): JobSourceCrawler => ({
	source,
	crawl: (): Promise<CrawlResult> =>
		Promise.resolve({ jobs: [], rejected: [], totalFound: 0 }),
	syncReference: (): Promise<number> => Promise.resolve(0),
});

describe("CrawlerRegistry", () => {
	it("resolves a source to the crawler that declared it", () => {
		const ocsc = crawlerFor(JobSource.OCSC);
		const dol = crawlerFor(JobSource.DOL);

		const registry = new CrawlerRegistry([ocsc, dol]);

		expect(registry.get(JobSource.OCSC)).toBe(ocsc);
		expect(registry.get(JobSource.DOL)).toBe(dol);
	});

	/**
	 * The distinction the controller turns into a 404 rather than a 409: the enum is a
	 * database type and carries values whose crawlers have not shipped yet.
	 */
	it("reports a registered-but-uncrawlable source as not found", () => {
		const registry = new CrawlerRegistry([crawlerFor(JobSource.OCSC)]);

		expect(registry.has(JobSource.MDES)).toBe(false);
		expect(() => registry.get(JobSource.MDES)).toThrow(NotFoundException);
	});

	it("lists only the sources it can actually crawl", () => {
		const registry = new CrawlerRegistry([
			crawlerFor(JobSource.OCSC),
			crawlerFor(JobSource.DOE),
		]);

		expect(registry.sources()).toEqual([JobSource.OCSC, JobSource.DOE]);
	});

	/**
	 * Provider order is an implementation detail of the module; production crawl order is
	 * not. Declaration order in the enum is the stable thing to key on.
	 */
	it("orders sources by the enum, not by registration", () => {
		const registry = new CrawlerRegistry([
			crawlerFor(JobSource.MDES),
			crawlerFor(JobSource.OCSC),
			crawlerFor(JobSource.DOL),
		]);

		expect(registry.sources()).toEqual([
			JobSource.OCSC,
			JobSource.DOL,
			JobSource.MDES,
		]);
	});

	/** Otherwise the loser would simply never run, with nothing in the logs to say so. */
	it("refuses to start when two crawlers claim one source", () => {
		expect(
			() =>
				new CrawlerRegistry([crawlerFor(JobSource.DOL), crawlerFor(JobSource.DOL)])
		).toThrow(/Two crawlers are registered for source DOL/);
	});
});

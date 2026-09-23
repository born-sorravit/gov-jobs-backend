import { CrawlerRegistry } from "@/modules/crawler/crawler.registry";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import {
	CrawlResult,
	JobSourceCrawler,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { JobSource } from "@/shared/enums/job-source.enum";

/**
 * `runAll`'s isolation guarantee, with persistence stubbed.
 *
 * The database is not what these assert — `crawler.e2e-spec.ts` covers persistence against
 * real SQL. What matters here is the control flow: which sources still get their turn after
 * an earlier one has failed or been skipped, which is exactly the property a mocked
 * repository can show and an integration test makes expensive to provoke.
 */

/** Records what it was asked to do and answers however the test set it up to. */
class FakeCrawler implements JobSourceCrawler {
	crawls = 0;
	failWith: Error | null = null;

	constructor(readonly source: JobSource) {}

	async crawl(): Promise<CrawlResult> {
		this.crawls += 1;
		if (this.failWith) throw this.failWith;
		return { jobs: [], rejected: [], totalFound: 0 };
	}

	async syncReference(): Promise<number> {
		return 0;
	}
}

/** The unique-violation shape `startRun` recognises as "this source is already crawling". */
const uniqueViolation = (): Error =>
	Object.assign(new Error("duplicate key value violates unique constraint"), {
		code: "23505",
	});

describe("CrawlerService.runAll", () => {
	let runId = 0;
	let saveRun: jest.Mock;

	const build = (
		crawlers: JobSourceCrawler[]
	): { service: CrawlerService; runs: { source: JobSource }[] } => {
		const runs: { source: JobSource }[] = [];

		saveRun = jest.fn((entity: { source: JobSource }) => {
			runs.push(entity);
			runId += 1;
			return Promise.resolve({ ...entity, id: `run-${runId}` });
		});

		const attachmentRepository = { find: jest.fn().mockResolvedValue([]) };

		const crawlerRunRepository = {
			create: (entity: unknown) => entity,
			save: saveRun,
			update: jest.fn().mockResolvedValue({ affected: 0 }),
		};

		const service = new CrawlerService(
			crawlerRunRepository as never,
			{ find: jest.fn().mockResolvedValue([]) } as never,
			attachmentRepository as never,
			{ addBulk: jest.fn().mockResolvedValue([]) } as never,
			// The document queue. Nothing is enqueued here — these fakes return no jobs — but
			// the constructor needs it.
			{ addBulk: jest.fn().mockResolvedValue([]) } as never,
			{ invalidate: jest.fn().mockResolvedValue(undefined) } as never,
			new CrawlerRegistry(crawlers),
			{ getOrThrow: () => ({ batchSize: 50 }) } as never
		);

		return { service, runs };
	};

	it("runs every registered source once", async () => {
		const ocsc = new FakeCrawler(JobSource.OCSC);
		const dol = new FakeCrawler(JobSource.DOL);
		const { service } = build([ocsc, dol]);

		const summary = await service.runAll("test");

		expect(ocsc.crawls).toBe(1);
		expect(dol.crawls).toBe(1);
		expect(summary).toMatchObject({
			totalSources: 2,
			succeeded: 2,
			failed: 0,
			skipped: 0,
		});
	});

	/** Requirement 29: DOL being down must not stop OCSC and MDES. */
	it("keeps going after a source fails, and reports which one", async () => {
		const ocsc = new FakeCrawler(JobSource.OCSC);
		const dol = new FakeCrawler(JobSource.DOL);
		const mdes = new FakeCrawler(JobSource.MDES);
		dol.failWith = new Error("source unreachable");

		const { service } = build([ocsc, dol, mdes]);

		const summary = await service.runAll("test");

		expect(ocsc.crawls).toBe(1);
		expect(mdes.crawls).toBe(1);
		expect(summary).toMatchObject({ totalSources: 3, succeeded: 2, failed: 1 });

		const failures = summary.runs.filter(
			(run) => run.status === CrawlerRunStatus.FAILED
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			source: JobSource.DOL,
			errorMessage: "source unreachable",
		});
	});

	/**
	 * The case `run` deliberately throws rather than swallows. Without the catch in `runAll`
	 * one source stuck mid-crawl would abort every source queued behind it.
	 */
	it("skips a source whose previous crawl is still in flight and runs the rest", async () => {
		const ocsc = new FakeCrawler(JobSource.OCSC);
		const dol = new FakeCrawler(JobSource.DOL);
		const mdes = new FakeCrawler(JobSource.MDES);

		const { service } = build([ocsc, dol, mdes]);
		saveRun.mockImplementationOnce((entity: { source: JobSource }) =>
			Promise.resolve({ ...entity, id: "run-ocsc" })
		);
		// Only DOL's attempt to claim the slot collides.
		saveRun.mockImplementationOnce(() => Promise.reject(uniqueViolation()));

		const summary = await service.runAll("test");

		expect(dol.crawls).toBe(0);
		expect(mdes.crawls).toBe(1);
		expect(summary).toMatchObject({ totalSources: 3, succeeded: 2, failed: 0 });
		expect(summary.skippedSources).toEqual([
			{ source: JobSource.DOL, reason: "A DOL crawl is already running" },
		]);
	});

	it("records each run against the source that produced it", async () => {
		const { service, runs } = build([
			new FakeCrawler(JobSource.OCSC),
			new FakeCrawler(JobSource.DOE),
		]);

		await service.runAll("scheduler");

		expect(runs.map((run) => run.source)).toEqual([JobSource.OCSC, JobSource.DOE]);
		expect(runs).toHaveLength(2);
	});

	it("is a no-op when nothing is registered", async () => {
		const { service } = build([]);

		expect(await service.runAll("test")).toMatchObject({
			totalSources: 0,
			succeeded: 0,
			failed: 0,
			skipped: 0,
			runs: [],
		});
	});
});

import { AppModule } from "@/app.module";
import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import {
	CrawlResult,
	JobSourceCrawler,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	OcscCrawler,
	SourceUnavailableError,
} from "@/modules/crawler/ocsc/ocsc.crawler";
import { normalizeOcscJob } from "@/modules/crawler/ocsc/ocsc.normalizer";
import { OcscRawJob } from "@/modules/crawler/ocsc/ocsc.types";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { JobSource } from "@/shared/enums/job-source.enum";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as fs from "node:fs";
import * as path from "node:path";
import { DataSource, In } from "typeorm";

/**
 * The crawl pipeline against a real database, with the network stubbed.
 *
 * The source is replaced by a fake so the run is deterministic and the tests never depend on
 * the live portal — but everything downstream (validation, dedup by content hash, attachment
 * replacement, the single-run guard, the audit row) is the real code against real SQL.
 */
/**
 * Announcement ids are remapped into a reserved range before use.
 *
 * The fixture carries OCSC's real ids, and `(source, external_id)` is the identity of a row
 * — so cleaning up after a test would delete the announcements a real crawl imported. The
 * content stays real; only the id is unmistakably test data.
 */
const TEST_ID_BASE = 900_000_000;

const FIXTURE: OcscRawJob[] = (
	JSON.parse(
		fs.readFileSync(path.join(__dirname, "fixtures/ocsc-jobs.fixture.json"), "utf8")
	) as OcscRawJob[]
).map((job, index) => ({ ...job, id: TEST_ID_BASE + index }));

const OPTIONS = { portalBaseUrl: "https://job.ocsc.go.th/portal" };

/** A stand-in for the portal whose responses each test controls. */
class FakeOcscCrawler implements JobSourceCrawler {
	readonly source = JobSource.OCSC;
	raw: OcscRawJob[] = [];
	failWith: Error | null = null;
	referenceSyncs = 0;
	delayMs = 0;

	async crawl(): Promise<CrawlResult> {
		if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
		if (this.failWith) throw this.failWith;

		const jobs = [];
		const rejected = [];
		for (const entry of this.raw) {
			try {
				jobs.push(normalizeOcscJob(entry, OPTIONS));
			} catch (error) {
				rejected.push({
					externalId: entry.id != null ? String(entry.id) : null,
					reason: (error as Error).message,
				});
			}
		}
		return { jobs, rejected, totalFound: this.raw.length };
	}

	async syncReference(): Promise<number> {
		this.referenceSyncs += 1;
		return 0;
	}
}

describe("OCSC crawl pipeline", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let crawler: CrawlerService;
	let fake: FakeOcscCrawler;

	/** A small, stable slice of the real snapshot. */
	const sample = (count: number): OcscRawJob[] =>
		FIXTURE.slice(0, count).map((job) => ({ ...job }));

	const externalIds = (jobs: OcscRawJob[]): string[] =>
		jobs.map((job) => String(job.id));

	const storedJobs = async (jobs: OcscRawJob[]): Promise<Job[]> =>
		dataSource.getRepository(Job).find({
			where: { source: JobSource.OCSC, externalId: In(externalIds(jobs)) },
			order: { externalId: "ASC" },
		});

	const cleanUp = async (): Promise<void> => {
		const ids = externalIds(FIXTURE);
		const jobs = await dataSource.getRepository(Job).find({
			where: { source: JobSource.OCSC, externalId: In(ids) },
			select: { id: true },
		});
		if (jobs.length > 0) {
			await dataSource
				.getRepository(JobAttachment)
				.delete({ jobId: In(jobs.map((j) => j.id)) });
			await dataSource.getRepository(Job).delete(jobs.map((j) => j.id));
		}
		// Only the runs this file created — a real crawl's audit trail must survive.
		await dataSource
			.getRepository(CrawlerRun)
			.delete({ source: JobSource.OCSC, trigger: "test" });
	};

	beforeAll(async () => {
		fake = new FakeOcscCrawler();
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(OcscCrawler)
			.useValue(fake)
			.compile();

		app = moduleRef.createNestApplication();
		await app.init();
		dataSource = app.get(DataSource);
		crawler = app.get(CrawlerService);
		await cleanUp();
	}, 60_000);

	afterEach(async () => {
		await cleanUp();
		fake.failWith = null;
		fake.delayMs = 0;
	});

	afterAll(async () => {
		await app?.close();
	});

	it("inserts every announcement on a first crawl and records the run", async () => {
		fake.raw = sample(5);

		const summary = await crawler.run(JobSource.OCSC, "test");

		expect(summary).toMatchObject({
			status: CrawlerRunStatus.SUCCESS,
			totalFound: 5,
			newJobs: 5,
			updatedJobs: 0,
			unchangedJobs: 0,
			skippedJobs: 0,
		});
		expect(summary.changedJobIds).toHaveLength(5);

		const run = await dataSource
			.getRepository(CrawlerRun)
			.findOneByOrFail({ id: summary.runId });
		expect(run).toMatchObject({
			status: CrawlerRunStatus.SUCCESS,
			totalFound: 5,
			newJobs: 5,
			trigger: "test",
		});
		expect(run.finishedAt).not.toBeNull();
	});

	it("re-crawling identical data writes nothing and enqueues nothing", async () => {
		fake.raw = sample(5);
		await crawler.run(JobSource.OCSC, "test");

		const summary = await crawler.run(JobSource.OCSC, "test");

		expect(summary).toMatchObject({
			newJobs: 0,
			updatedJobs: 0,
			unchangedJobs: 5,
			totalFound: 5,
		});
		// Nothing downstream should be woken up for an announcement that did not move.
		expect(summary.changedJobIds).toEqual([]);
	});

	it("does not create a duplicate row for an announcement it has already seen", async () => {
		fake.raw = sample(5);
		await crawler.run(JobSource.OCSC, "test");
		await crawler.run(JobSource.OCSC, "test");
		await crawler.run(JobSource.OCSC, "test");

		expect(await storedJobs(fake.raw)).toHaveLength(5);
	});

	it("updates and reports only the announcement that actually changed", async () => {
		fake.raw = sample(5);
		await crawler.run(JobSource.OCSC, "test");

		fake.raw = sample(5);
		fake.raw[2].applicationEnd = "2099-12-31";

		const summary = await crawler.run(JobSource.OCSC, "test");

		expect(summary).toMatchObject({ newJobs: 0, updatedJobs: 1, unchangedJobs: 4 });
		expect(summary.changedJobIds).toHaveLength(1);

		const stored = await dataSource.getRepository(Job).findOneByOrFail({
			source: JobSource.OCSC,
			externalId: String(fake.raw[2].id),
		});
		expect(stored.applicationEnd).toBe("2099-12-31");
	});

	it("ignores view counters, which move on every request", async () => {
		fake.raw = sample(3);
		await crawler.run(JobSource.OCSC, "test");

		fake.raw = sample(3).map((job) => ({
			...job,
			webView: 99_999,
			mobileView: 4242,
		}));
		const summary = await crawler.run(JobSource.OCSC, "test");

		expect(summary).toMatchObject({ updatedJobs: 0, unchangedJobs: 3 });
	});

	it("moves lastSeenAt forward even when nothing changed", async () => {
		fake.raw = sample(2);
		await crawler.run(JobSource.OCSC, "test");
		const [before] = await storedJobs(fake.raw);

		await new Promise((r) => setTimeout(r, 1100));
		await crawler.run(JobSource.OCSC, "test");
		const [after] = await storedJobs(fake.raw);

		expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
		// firstSeenAt is what alerts match on, so it must never move.
		expect(after.firstSeenAt.getTime()).toBe(before.firstSeenAt.getTime());
	});

	it("stores the announcement PDF as an attachment, once", async () => {
		fake.raw = sample(1);
		await crawler.run(JobSource.OCSC, "test");
		await crawler.run(JobSource.OCSC, "test");

		const [job] = await storedJobs(fake.raw);
		const attachments = await dataSource
			.getRepository(JobAttachment)
			.find({ where: { jobId: job.id } });

		expect(attachments).toHaveLength(1);
		expect(attachments[0].url).toBe(fake.raw[0].fileName);
	});

	it("replaces an attachment when the source republishes the file", async () => {
		fake.raw = sample(1);
		await crawler.run(JobSource.OCSC, "test");

		fake.raw = sample(1);
		fake.raw[0].fileName = "https://job.ocsc.go.th/upload2/job-99999.pdf";
		fake.raw[0].applicationEnd = "2099-11-30"; // force a content change
		await crawler.run(JobSource.OCSC, "test");

		const [job] = await storedJobs(fake.raw);
		const attachments = await dataSource
			.getRepository(JobAttachment)
			.find({ where: { jobId: job.id } });

		expect(attachments).toHaveLength(1);
		expect(attachments[0].url).toBe("https://job.ocsc.go.th/upload2/job-99999.pdf");
	});

	describe("failure isolation", () => {
		it("skips a malformed announcement and keeps the rest", async () => {
			fake.raw = [
				...sample(3),
				{ position: "ไม่มี id", department: "หน่วยงาน" } as OcscRawJob,
			];

			const summary = await crawler.run(JobSource.OCSC, "test");

			expect(summary).toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
				totalFound: 4,
				newJobs: 3,
				skippedJobs: 1,
			});
		});

		it("records a source failure on the run instead of throwing", async () => {
			fake.raw = sample(2);
			fake.failWith = new SourceUnavailableError("GET /portal/jobs returned 503");

			const summary = await crawler.run(JobSource.OCSC, "test");

			expect(summary.status).toBe(CrawlerRunStatus.FAILED);
			expect(summary.errorMessage).toContain("503");

			const run = await dataSource
				.getRepository(CrawlerRun)
				.findOneByOrFail({ id: summary.runId });
			expect(run.status).toBe(CrawlerRunStatus.FAILED);
			expect(run.finishedAt).not.toBeNull();
		});

		it("leaves previously crawled announcements untouched when a later run fails", async () => {
			fake.raw = sample(3);
			await crawler.run(JobSource.OCSC, "test");

			fake.failWith = new SourceUnavailableError("network down");
			await crawler.run(JobSource.OCSC, "test");

			// The database is an archive: a failed crawl must never remove what we already have.
			expect(await storedJobs(sample(3))).toHaveLength(3);
		});

		it("releases the slot after a failure so the next crawl can start", async () => {
			fake.raw = sample(1);
			fake.failWith = new SourceUnavailableError("transient");
			await crawler.run(JobSource.OCSC, "test");

			fake.failWith = null;
			const summary = await crawler.run(JobSource.OCSC, "test");
			expect(summary.status).toBe(CrawlerRunStatus.SUCCESS);
		});
	});

	describe("single-run guard", () => {
		it("rejects a second crawl while one is in flight", async () => {
			fake.raw = sample(2);
			fake.delayMs = 1500;

			const first = crawler.run(JobSource.OCSC, "test");
			await new Promise((r) => setTimeout(r, 200));

			await expect(crawler.run(JobSource.OCSC, "test")).rejects.toThrow(
				/already running/i
			);
			await expect(first).resolves.toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
			});
		});
	});

	it("refreshes the taxonomies before importing announcements", async () => {
		fake.raw = sample(1);
		const before = fake.referenceSyncs;

		await crawler.run(JobSource.OCSC, "test");

		expect(fake.referenceSyncs).toBe(before + 1);
	});
});

import { AppModule } from "@/app.module";
import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { CrawlerRegistry } from "@/modules/crawler/crawler.registry";
import { CrawlerService, RunAllSummary } from "@/modules/crawler/crawler.service";
import { DolCrawler } from "@/modules/crawler/dol/dol.crawler";
import { MdesCrawler } from "@/modules/crawler/mdes/mdes.crawler";
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
import { ExtractionStatus } from "@/shared/enums/extraction.enum";
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

/**
 * Stands in for the HTML sources so `run-all` has more than one without the suite reaching
 * the live sites. Every source-specific assertion lives in that source's parser spec, against
 * captured HTML; what matters here is only that each registered source takes its turn.
 */
class FakeCrawler implements JobSourceCrawler {
	failWith: Error | null = null;
	crawls = 0;

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

describe("OCSC crawl pipeline", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let crawler: CrawlerService;
	let registry: CrawlerRegistry;
	let fake: FakeOcscCrawler;
	let fakeDol: FakeCrawler;
	let fakeMdes: FakeCrawler;

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
		// Scoped by source as well as trigger: `trigger` is free text with no namespacing, and
		// the source filter is what keeps this from ever reaching a run this file did not make.
		await dataSource.getRepository(CrawlerRun).delete({
			source: In([JobSource.OCSC, JobSource.DOL, JobSource.MDES]),
			trigger: In(["test", "test-run-all"]),
		});
	};

	beforeAll(async () => {
		fake = new FakeOcscCrawler();
		fakeDol = new FakeCrawler(JobSource.DOL);
		fakeMdes = new FakeCrawler(JobSource.MDES);
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(OcscCrawler)
			.useValue(fake)
			// Faked for the same reason as OCSC: a suite that reaches กรมที่ดิน over the network
			// is neither deterministic nor polite to run on every commit.
			.overrideProvider(DolCrawler)
			.useValue(fakeDol)
			.overrideProvider(MdesCrawler)
			.useValue(fakeMdes)
			.compile();

		app = moduleRef.createNestApplication();
		await app.init();
		dataSource = app.get(DataSource);
		crawler = app.get(CrawlerService);
		registry = app.get(CrawlerRegistry);
		await cleanUp();
	}, 60_000);

	afterEach(async () => {
		await cleanUp();
		fake.failWith = null;
		fake.delayMs = 0;
		fakeDol.failWith = null;
		fakeMdes.failWith = null;
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

	/**
	 * An attachment is identified by its URL, so a row whose URL still appears is kept rather
	 * than replaced — which used to mean its name could never change. That became a real gap
	 * once free text started being canonicalised: a name stored in the older spelling would
	 * have kept it forever, because nothing about the URL moved.
	 */
	it("updates an attachment's name in place when only the name changed", async () => {
		fake.raw = sample(1);
		await crawler.run(JobSource.OCSC, "test");

		const [job] = await storedJobs(fake.raw);
		const repository = dataSource.getRepository(JobAttachment);
		const [before] = await repository.find({ where: { jobId: job.id } });

		// Stand in for a row written before normalisation: same URL, older spelling.
		await repository.update(before.id, { name: "ประกาศรับสม\u0E4D\u0E32คร" });

		fake.raw = sample(1);
		fake.raw[0].applicationEnd = "2099-10-31"; // force a content change so the job is re-persisted
		await crawler.run(JobSource.OCSC, "test");

		const after = await repository.find({ where: { jobId: job.id } });
		expect(after).toHaveLength(1);
		expect(after[0].id).toBe(before.id); // updated, not deleted and reinserted
		expect(after[0].name).toBe("ประกาศรับสมัคร");
	});

	/**
	 * The crawl's hand-off to document processing. The extraction itself is unit-tested
	 * against real PDFs; what only the container shows is that imported attachments arrive
	 * PENDING and are actually offered to the queue.
	 */
	it("imports attachments PENDING and hands them to the document queue", async () => {
		fake.raw = sample(3);

		const summary = await crawler.run(JobSource.OCSC, "test");

		const jobs = await storedJobs(fake.raw);
		const attachments = await dataSource
			.getRepository(JobAttachment)
			.find({ where: { jobId: In(jobs.map((job) => job.id)) } });

		expect(attachments.length).toBeGreaterThan(0);
		// The count is computed by the crawl, before the worker can touch anything. The
		// attachments' own status deliberately is not asserted: the document worker is live in
		// this app and races the assertion, and what this test is about is the hand-off.
		expect(summary.documentsEnqueued).toBeGreaterThanOrEqual(attachments.length);
	});

	/**
	 * The gap this closed: an attachment is unread for reasons unrelated to its announcement
	 * moving — imported before extraction existed, reset after a failed download, or worth
	 * reading again with a better parser. Scoping the sweep to changed announcements left
	 * every one of those unread forever, because their announcements never change again.
	 */
	it("picks up an unread attachment even when its announcement did not change", async () => {
		fake.raw = sample(2);
		await crawler.run(JobSource.OCSC, "test");

		const jobs = await storedJobs(fake.raw);
		const repository = dataSource.getRepository(JobAttachment);
		await repository.update(
			{ jobId: In(jobs.map((job) => job.id)) },
			{ extractionStatus: ExtractionStatus.COMPLETED, extractedText: "เดิม" }
		);

		// Reset one, as re-processing would, and change nothing about the announcement.
		const [first] = await repository.find({
			where: { jobId: In(jobs.map((job) => job.id)) },
		});
		await repository.update(first.id, {
			extractionStatus: ExtractionStatus.PENDING,
		});

		fake.raw = sample(2);
		const summary = await crawler.run(JobSource.OCSC, "test");

		expect(summary.unchangedJobs).toBe(2);
		expect(summary.documentsEnqueued).toBeGreaterThanOrEqual(1);
	});

	/** A document already read keeps its text; re-crawling must not queue it again. */
	it("does not re-enqueue an attachment that has already been read", async () => {
		fake.raw = sample(2);
		await crawler.run(JobSource.OCSC, "test");

		const jobs = await storedJobs(fake.raw);
		const repository = dataSource.getRepository(JobAttachment);
		await repository.update(
			{ jobId: In(jobs.map((job) => job.id)) },
			{
				extractionStatus: ExtractionStatus.COMPLETED,
				extractedText: "เนื้อหาประกาศที่อ่านไว้แล้ว",
			}
		);

		fake.raw = sample(2);
		fake.raw[0].applicationEnd = "2099-09-30"; // force a re-persist
		await crawler.run(JobSource.OCSC, "test");

		// Asserted on these attachments rather than on the crawl's total: the sweep is global
		// by design, so unrelated unread rows left by other tests would make a count flaky.
		const after = await repository.find({
			where: { jobId: In(jobs.map((job) => job.id)) },
		});
		for (const attachment of after) {
			expect(attachment.extractionStatus).toBe(ExtractionStatus.COMPLETED);
			expect(attachment.extractedText).toBe("เนื้อหาประกาศที่อ่านไว้แล้ว");
		}
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

	/**
	 * `runAll`'s branching is unit-tested against mocks; what only the real container can
	 * show is that the registry is wired to the same crawler instances `run` uses — the
	 * factory behind `JOB_SOURCE_CRAWLERS` resolves its providers through Nest, so an
	 * overridden provider has to reach it or these assertions fail.
	 */
	describe("run-all", () => {
		it("registers exactly the sources that have a crawler", () => {
			expect(registry.sources()).toEqual([
				JobSource.OCSC,
				JobSource.DOL,
				JobSource.MDES,
			]);
			// Still in the enum, still without a crawler — the 404 case.
			expect(registry.has(JobSource.ADMIN_COURT)).toBe(false);
		});

		/** The summary entry for one source, so these read the same however many are registered. */
		const runFor = (summary: RunAllSummary, source: JobSource) =>
			summary.runs.find((run) => run.source === source);

		it("gives every registered source a turn and persists what they return", async () => {
			fake.raw = sample(4);

			const summary = await crawler.runAll("test-run-all");

			expect(summary).toMatchObject({
				totalSources: registry.sources().length,
				failed: 0,
				skipped: 0,
			});
			expect(summary.succeeded).toBe(registry.sources().length);
			expect(runFor(summary, JobSource.OCSC)).toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
				newJobs: 4,
			});
			expect(fakeDol.crawls).toBe(1);
			expect(fakeMdes.crawls).toBe(1);
			expect(await storedJobs(fake.raw)).toHaveLength(4);
		});

		/** Requirement 29, against real SQL: DOL failing must not cost OCSC its run. */
		it("keeps crawling the other sources after one fails", async () => {
			fake.raw = sample(2);
			fakeDol.failWith = new SourceUnavailableError("DOL listing returned 503");

			const summary = await crawler.runAll("test-run-all");

			expect(summary).toMatchObject({ failed: 1, skipped: 0 });
			expect(runFor(summary, JobSource.DOL)).toMatchObject({
				status: CrawlerRunStatus.FAILED,
			});
			expect(runFor(summary, JobSource.OCSC)).toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
				newJobs: 2,
			});
		});

		it("skips a source whose crawl is still in flight and runs the rest", async () => {
			fake.raw = sample(2);
			fake.delayMs = 1500;

			const inFlight = crawler.run(JobSource.OCSC, "test");
			await new Promise((r) => setTimeout(r, 200));

			const summary = await crawler.runAll("test-run-all");

			expect(summary).toMatchObject({ failed: 0, skipped: 1 });
			expect(summary.skippedSources[0]).toMatchObject({ source: JobSource.OCSC });
			// The source behind the blocked one still got its turn.
			expect(runFor(summary, JobSource.DOL)).toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
			});
			await expect(inFlight).resolves.toMatchObject({
				status: CrawlerRunStatus.SUCCESS,
			});
		});
	});
});

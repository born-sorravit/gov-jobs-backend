import { AppModule } from "@/app.module";
import { QUEUE_JOB_MATCHING } from "@/constants/queue.constants";
import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { User } from "@/models/users/entities/user.entity";
import { CrawlerService } from "@/modules/crawler/crawler.service";
import {
	CrawlResult,
	JobSourceCrawler,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import { OcscCrawler } from "@/modules/crawler/ocsc/ocsc.crawler";
import { normalizeOcscJob } from "@/modules/crawler/ocsc/ocsc.normalizer";
import { OcscRawJob } from "@/modules/crawler/ocsc/ocsc.types";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { JobSource } from "@/shared/enums/job-source.enum";
import { UserRole } from "@/shared/enums/user-role.enum";
import { getQueueToken } from "@nestjs/bullmq";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Queue } from "bullmq";
import * as fs from "node:fs";
import * as path from "node:path";
import { DataSource, In, Like } from "typeorm";

/**
 * The crawl → queue → matching path, against a real Postgres-backed BullMQ.
 *
 * This is the one thing a unit test cannot show: the crawl now *returns* before matching has
 * happened, so the assertion is that the rows appear afterwards, written by a worker.
 */
const DOMAIN = "@queue-e2e.test";
const TEST_ID_BASE = 910_000_000;

const FIXTURE: OcscRawJob[] = (
	JSON.parse(
		fs.readFileSync(path.join(__dirname, "fixtures/ocsc-jobs.fixture.json"), "utf8")
	) as OcscRawJob[]
).map((job, index) => ({ ...job, id: TEST_ID_BASE + index }));

class FakeCrawler implements JobSourceCrawler {
	readonly source = JobSource.OCSC;
	raw: OcscRawJob[] = [];

	async crawl(): Promise<CrawlResult> {
		const jobs = this.raw.map((entry) =>
			normalizeOcscJob(entry, { portalBaseUrl: "https://job.ocsc.go.th/portal" })
		);
		return { jobs, rejected: [], totalFound: this.raw.length };
	}

	async syncReference(): Promise<number> {
		return 0;
	}
}

describe("crawl → queue → matching", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let crawler: CrawlerService;
	let queue: Queue;
	let fake: FakeCrawler;
	let userId: string;

	/** Waits for the matching queue to have nothing left to do. */
	const drain = async (timeoutMs = 30_000): Promise<void> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const counts = await queue.getJobCounts("waiting", "active", "delayed");
			if (
				(counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) ===
				0
			) {
				// The last job's database writes may still be landing.
				await new Promise((resolve) => setTimeout(resolve, 300));
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error("matching queue did not drain");
	};

	const cleanUp = async (): Promise<void> => {
		const alerts = await dataSource
			.getRepository(JobAlert)
			.find({ where: { userId }, select: { id: true } });
		if (alerts.length > 0) {
			await dataSource
				.getRepository(JobAlertMatch)
				.delete({ jobAlertId: In(alerts.map((a) => a.id)) });
		}
		await dataSource.getRepository(JobAlert).delete({ userId });

		const ids = FIXTURE.map((job) => String(job.id));
		const jobs = await dataSource.getRepository(Job).find({
			where: { source: JobSource.OCSC, externalId: In(ids) },
			select: { id: true },
		});
		if (jobs.length > 0) {
			await dataSource.getRepository(Job).delete(jobs.map((job) => job.id));
		}
		// Also clears any row left RUNNING by an aborted test: the partial unique index means
		// one stale row blocks every later crawl in this suite.
		await dataSource
			.getRepository(CrawlerRun)
			.delete({ source: JobSource.OCSC, status: CrawlerRunStatus.RUNNING });
		await dataSource
			.getRepository(CrawlerRun)
			.delete({ source: JobSource.OCSC, trigger: "queue-test" });
	};

	beforeAll(async () => {
		fake = new FakeCrawler();
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(OcscCrawler)
			.useValue(fake)
			.compile();

		app = moduleRef.createNestApplication();
		await app.init();
		dataSource = app.get(DataSource);
		crawler = app.get(CrawlerService);
		queue = app.get<Queue>(getQueueToken(QUEUE_JOB_MATCHING));

		const user = await dataSource.getRepository(User).save(
			dataSource.getRepository(User).create({
				email: `owner${DOMAIN}`,
				passwordHash: "x",
				name: "เจ้าของ",
				role: UserRole.USER,
			})
		);
		userId = user.id;
		await cleanUp();
	}, 90_000);

	afterEach(cleanUp);

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
		}
		await app?.close();
	});

	it("uses the PostgreSQL backend, not Redis", async () => {
		// If the default factory had not been installed, constructing this queue would have
		// built a Redis backend and tried to reach localhost:6379.
		await expect(queue.getJobCounts("waiting")).resolves.toBeDefined();
	});

	it("returns from the crawl before matching has run, then records the matches", async () => {
		const alert = await dataSource.getRepository(JobAlert).save(
			dataSource.getRepository(JobAlert).create({
				userId,
				name: "ทุกตำแหน่ง",
				keywords: ["เจ้าพนักงาน"],
				jobTypes: [],
				educations: [],
				provinces: [],
				notificationEmail: `owner${DOMAIN}`,
				frequency: AlertFrequency.IMMEDIATE,
				isActive: true,
				matchFrom: new Date(Date.now() - 3_600_000),
			})
		);

		fake.raw = FIXTURE.slice(0, 8);
		const summary = await crawler.run(JobSource.OCSC, "queue-test");

		expect(summary.newJobs).toBe(8);
		expect(summary.matchingEnqueued).toBe(8);

		await drain();

		// This suite's own alert must have been matched by the worker, not by the crawl.
		const myMatches = await dataSource
			.getRepository(JobAlertMatch)
			.count({ where: { jobAlertId: alert.id } });
		expect(myMatches).toBeGreaterThan(0);

		// The run's counter is across *every* alert that matched these announcements — other
		// e2e files share this database and leave alerts of their own behind — so it is
		// compared against the matches for this run's announcements, not for this alert.
		const importedJobs = await dataSource.getRepository(Job).find({
			where: {
				source: JobSource.OCSC,
				externalId: In(fake.raw.map((job) => String(job.id))),
			},
			select: { id: true },
		});
		const matchesForThisRun = await dataSource
			.getRepository(JobAlertMatch)
			.count({ where: { jobId: In(importedJobs.map((job) => job.id)) } });

		const run = await dataSource
			.getRepository(CrawlerRun)
			.findOneByOrFail({ id: summary.runId });
		expect(run.alertMatches).toBe(matchesForThisRun);
	}, 120_000);

	it("enqueues nothing when a crawl changes nothing", async () => {
		fake.raw = FIXTURE.slice(0, 4);
		await crawler.run(JobSource.OCSC, "queue-test");
		await drain();

		const second = await crawler.run(JobSource.OCSC, "queue-test");

		expect(second.unchangedJobs).toBe(4);
		expect(second.matchingEnqueued).toBe(0);
	}, 120_000);

	it("does not double-record when the same announcements are enqueued twice", async () => {
		const duplicateAlert = await dataSource.getRepository(JobAlert).save(
			dataSource.getRepository(JobAlert).create({
				userId,
				name: "ซ้ำ",
				keywords: ["เจ้าพนักงาน"],
				jobTypes: [],
				educations: [],
				provinces: [],
				notificationEmail: `owner${DOMAIN}`,
				frequency: AlertFrequency.IMMEDIATE,
				isActive: true,
				matchFrom: new Date(Date.now() - 3_600_000),
			})
		);

		fake.raw = FIXTURE.slice(0, 5);
		const first = await crawler.run(JobSource.OCSC, "queue-test");
		await drain();
		const afterFirst = await dataSource
			.getRepository(JobAlertMatch)
			.count({ where: { jobAlertId: duplicateAlert.id } });

		// Force the same announcements through the pipeline again.
		const jobs = await dataSource.getRepository(Job).find({
			where: {
				source: JobSource.OCSC,
				externalId: In(fake.raw.map((j) => String(j.id))),
			},
		});
		await dataSource
			.getRepository(Job)
			.update(
				{ id: In(jobs.map((j) => j.id)) },
				{ contentHash: () => "'changed-' || id::text" }
			);

		await crawler.run(JobSource.OCSC, "queue-test");
		await drain();

		expect(
			await dataSource
				.getRepository(JobAlertMatch)
				.count({ where: { jobAlertId: duplicateAlert.id } })
		).toBe(afterFirst);
		expect(first.matchingEnqueued).toBe(5);
	}, 120_000);
});

import { AppModule } from "@/app.module";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { JobSource } from "@/shared/enums/job-source.enum";
import { JobStatus } from "@/shared/enums/job-status.enum";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { getLocalDateString } from "@/shared/utils/date.util";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import request from "supertest";

/**
 * Exercises `GET /jobs` against a real Postgres, because every interesting decision in it is
 * SQL: array overlap, the nationwide wildcard, nullable salary bounds, and the status CASE.
 *
 * Rows are hand-built rather than normalised from the crawler fixture — the normaliser is
 * step 4's, and controlled inputs pin filter semantics far better than 51 real ones. Titles
 * and agencies are copied verbatim from the fixture so the Thai trigram path is real.
 */
const AGENCY = "e2e-jobs-api-fixture";

const BANGKOK = 2;
const CHIANG_MAI = 14;
const YALA = 47;
const BACHELOR = 8;
const VOCATIONAL = 3;
const TYPE_GENERAL = 1;
const TYPE_ACADEMIC = 2;
const CATEGORY_CIVIL = 1;
const CATEGORY_EMPLOYEE = 2;

interface Seed {
	key: string;
	title: string;
	ministry?: string | null;
	provinceIds: number[];
	educationLevelIds: number[];
	jobTypeId: number;
	jobCategoryId: number;
	salaryMin: number | null;
	salaryMax: number | null;
	applicationStart: string | null;
	applicationEnd: string | null;
}

// Dates are relative to today so the status assertions never rot.
const day = (offset: number): string => {
	const d = new Date(`${getLocalDateString()}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().slice(0, 10);
};

const SEEDS: Seed[] = [
	{
		key: "bangkok-open",
		title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
		ministry: "กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม",
		provinceIds: [BANGKOK],
		educationLevelIds: [BACHELOR],
		jobTypeId: TYPE_ACADEMIC,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: 16_500,
		salaryMax: 18_150,
		applicationStart: day(-5),
		applicationEnd: day(10),
	},
	{
		key: "chiangmai-open",
		title: "เจ้าพนักงานธุรการปฏิบัติงาน",
		ministry: "กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์",
		provinceIds: [CHIANG_MAI],
		educationLevelIds: [VOCATIONAL],
		jobTypeId: TYPE_GENERAL,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: 13_920,
		salaryMax: 15_320,
		applicationStart: day(-2),
		applicationEnd: day(20),
	},
	{
		key: "nationwide-open",
		title: "นักพัฒนาระบบสารสนเทศ",
		ministry: "กระทรวงสาธารณสุข",
		provinceIds: [], // nationwide — must appear under every province filter
		educationLevelIds: [BACHELOR],
		jobTypeId: TYPE_ACADEMIC,
		jobCategoryId: CATEGORY_EMPLOYEE,
		salaryMin: 18_000,
		salaryMax: 22_000,
		applicationStart: day(-1),
		applicationEnd: day(30),
	},
	{
		key: "no-salary",
		title: "นักวิเคราะห์นโยบายและแผน",
		ministry: "กระทรวงมหาดไทย",
		provinceIds: [YALA],
		educationLevelIds: [BACHELOR],
		jobTypeId: TYPE_ACADEMIC,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: null, // unpublished salary must not vanish from a salary filter
		salaryMax: null,
		applicationStart: day(-3),
		applicationEnd: day(15),
	},
	{
		key: "upcoming",
		title: "นายช่างโยธาปฏิบัติงาน",
		provinceIds: [BANGKOK],
		educationLevelIds: [VOCATIONAL],
		jobTypeId: TYPE_GENERAL,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: 13_920,
		salaryMax: 15_320,
		applicationStart: day(7),
		applicationEnd: day(30),
	},
	{
		key: "closed",
		title: "นักทรัพยากรบุคคลปฏิบัติการ",
		provinceIds: [BANGKOK],
		educationLevelIds: [BACHELOR],
		jobTypeId: TYPE_ACADEMIC,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: 16_500,
		salaryMax: 18_150,
		applicationStart: day(-40),
		applicationEnd: day(-1),
	},
	{
		key: "no-deadline",
		title: "พนักงานบริการ",
		provinceIds: [CHIANG_MAI],
		educationLevelIds: [VOCATIONAL],
		jobTypeId: TYPE_GENERAL,
		jobCategoryId: CATEGORY_EMPLOYEE,
		salaryMin: 10_000,
		salaryMax: 12_000,
		applicationStart: day(-10),
		applicationEnd: null,
	},
	{
		key: "high-salary",
		title: "ผู้อำนวยการกองเทคโนโลยีสารสนเทศ",
		provinceIds: [BANGKOK],
		educationLevelIds: [BACHELOR],
		jobTypeId: TYPE_ACADEMIC,
		jobCategoryId: CATEGORY_CIVIL,
		salaryMin: 60_000,
		salaryMax: 100_000,
		applicationStart: day(-5),
		applicationEnd: day(25),
	},
];

const createApp = async (): Promise<INestApplication> => {
	const moduleRef = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	const app = moduleRef.createNestApplication();
	app.setGlobalPrefix("api", { exclude: ["healthcheck"] });
	app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
	app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
	app.useGlobalInterceptors(new ResponseFormatInterceptor());
	app.useGlobalFilters(new GlobalExceptionFilter());
	await app.init();
	return app;
};

let app: INestApplication;
let dataSource: DataSource;

beforeAll(async () => {
	app = await createApp();
	dataSource = app.get(DataSource);
}, 60_000);

afterAll(async () => {
	await app?.close();
});

describe("GET /api/v1/jobs", () => {
	const ids = new Map<string, string>();

	const list = (queryString = ""): request.Test =>
		request(app.getHttpServer()).get(`/api/v1/jobs?limit=100&${queryString}`);

	/** The seeded rows in a response, by key, ignoring anything else in the database. */
	const keysIn = (body: { data: { externalId: string }[] }): string[] =>
		body.data
			.filter((job) => job.externalId.startsWith("e2e-"))
			.map((job) => job.externalId.replace("e2e-", ""))
			.sort();

	beforeAll(async () => {
		const jobs = dataSource.getRepository(Job);
		await jobs.delete({ agency: AGENCY });

		for (const seed of SEEDS) {
			const saved = await jobs.save(
				jobs.create({
					source: JobSource.OCSC,
					externalId: `e2e-${seed.key}`,
					title: seed.title,
					agency: AGENCY,
					ministry: seed.ministry ?? null,
					jobTypeId: seed.jobTypeId,
					jobCategoryId: seed.jobCategoryId,
					provinceIds: seed.provinceIds,
					educationLevelIds: seed.educationLevelIds,
					salaryMin: seed.salaryMin,
					salaryMax: seed.salaryMax,
					applicationStart: seed.applicationStart,
					applicationEnd: seed.applicationEnd,
					sourceUrl: `https://job.ocsc.go.th/portal/jobs/${seed.key}`,
					contentHash: `e2e-${seed.key}`,
					publishedAt: new Date(),
				})
			);
			ids.set(seed.key, saved.id);
		}
	}, 60_000);

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(Job).delete({ agency: AGENCY });
		}
	});

	it("envelopes the page with pagination meta", async () => {
		const { body } = await list().expect(200);

		expect(body.status).toBe("success");
		expect(body.meta).toEqual(
			expect.objectContaining({ page: 1, limit: 100, total: expect.any(Number) })
		);
		expect(keysIn(body)).toHaveLength(SEEDS.length);
	});

	describe("keyword search", () => {
		it("matches a Thai substring in the title", async () => {
			const { body } = await list("q=คอมพิวเตอร์").expect(200);
			expect(keysIn(body)).toEqual(["bangkok-open"]);
		});

		it("matches on ministry, not just title and agency", async () => {
			const { body } = await list("q=สาธารณสุข").expect(200);
			expect(keysIn(body)).toEqual(["nationwide-open"]);
		});

		it("returns nothing for a term that appears nowhere", async () => {
			const { body } = await list("q=ไม่มีคำนี้อยู่จริง").expect(200);
			expect(keysIn(body)).toEqual([]);
		});

		it("ignores a whitespace-only search box", async () => {
			const { body } = await list("q=%20%20").expect(200);
			expect(keysIn(body)).toHaveLength(SEEDS.length);
		});
	});

	describe("province filter", () => {
		it("includes nationwide announcements by default", async () => {
			const { body } = await list(`province=${YALA}`).expect(200);
			expect(keysIn(body)).toEqual(["nationwide-open", "no-salary"]);
		});

		it("excludes them under provinceStrict", async () => {
			const { body } = await list(`province=${YALA}&provinceStrict=true`).expect(
				200
			);
			expect(keysIn(body)).toEqual(["no-salary"]);
		});

		it("ORs multiple provinces", async () => {
			const { body } = await list(
				`province=${CHIANG_MAI}&province=${YALA}&provinceStrict=true`
			).expect(200);
			expect(keysIn(body)).toEqual(["chiangmai-open", "no-deadline", "no-salary"]);
		});

		it("accepts a comma-separated list identically", async () => {
			const { body } = await list(
				`province=${CHIANG_MAI},${YALA}&provinceStrict=true`
			).expect(200);
			expect(keysIn(body)).toEqual(["chiangmai-open", "no-deadline", "no-salary"]);
		});

		it("flags nationwide rows so the card can label them", async () => {
			const { body } = await list(`province=${YALA}`).expect(200);
			const nationwide = body.data.find(
				(job: { externalId: string }) => job.externalId === "e2e-nationwide-open"
			);
			expect(nationwide.isNationwide).toBe(true);
			expect(nationwide.provinceIds).toEqual([]);
		});
	});

	describe("education, type and category filters", () => {
		it("matches any selected education level", async () => {
			const { body } = await list(`education=${VOCATIONAL}`).expect(200);
			expect(keysIn(body)).toEqual(["chiangmai-open", "no-deadline", "upcoming"]);
		});

		it("filters by position type", async () => {
			const { body } = await list(`jobType=${TYPE_GENERAL}`).expect(200);
			expect(keysIn(body)).toEqual(["chiangmai-open", "no-deadline", "upcoming"]);
		});

		it("filters by job category", async () => {
			const { body } = await list(`jobCategory=${CATEGORY_EMPLOYEE}`).expect(200);
			expect(keysIn(body)).toEqual(["nationwide-open", "no-deadline"]);
		});

		it("ANDs across dimensions", async () => {
			const { body } = await list(
				`jobType=${TYPE_ACADEMIC}&education=${BACHELOR}&province=${BANGKOK}&provinceStrict=true`
			).expect(200);
			expect(keysIn(body)).toEqual(["bangkok-open", "closed", "high-salary"]);
		});
	});

	describe("status", () => {
		it("returns only open announcements", async () => {
			const { body } = await list(`status=${JobStatus.OPEN}`).expect(200);
			expect(keysIn(body)).toEqual([
				"bangkok-open",
				"chiangmai-open",
				"high-salary",
				"nationwide-open",
				"no-deadline",
				"no-salary",
			]);
		});

		it("returns only upcoming announcements", async () => {
			const { body } = await list(`status=${JobStatus.UPCOMING}`).expect(200);
			expect(keysIn(body)).toEqual(["upcoming"]);
		});

		it("returns only closed announcements", async () => {
			const { body } = await list(`status=${JobStatus.CLOSED}`).expect(200);
			expect(keysIn(body)).toEqual(["closed"]);
		});

		it("agrees with the status it renders on each row", async () => {
			const { body } = await list(`status=${JobStatus.OPEN}`).expect(200);
			for (const job of body.data) {
				expect(job.status).toBe(JobStatus.OPEN);
			}
		});

		it("rejects a status outside the enum", async () => {
			await list("status=BANANA").expect(400);
		});

		it("reports days until the deadline", async () => {
			const { body } = await list("q=คอมพิวเตอร์").expect(200);
			expect(body.data[0].daysUntilDeadline).toBe(10);
		});
	});

	describe("salary", () => {
		it("keeps announcements whose salary was never published", async () => {
			const { body } = await list("salaryMin=50000").expect(200);
			expect(keysIn(body)).toContain("no-salary");
			expect(keysIn(body)).toContain("high-salary");
		});

		it("excludes announcements whose ceiling is below the floor asked for", async () => {
			const { body } = await list("salaryMin=50000").expect(200);
			expect(keysIn(body)).not.toContain("chiangmai-open");
		});

		it("excludes announcements whose floor is above the ceiling asked for", async () => {
			const { body } = await list("salaryMax=14000").expect(200);
			expect(keysIn(body)).not.toContain("high-salary");
			expect(keysIn(body)).toContain("no-deadline");
		});

		it("combines both bounds as a range overlap", async () => {
			const { body } = await list("salaryMin=16000&salaryMax=19000").expect(200);
			// high-salary is excluded: its floor (60,000) is above the ceiling asked for, even
			// though its ceiling clears the floor — both ends have to overlap.
			expect(keysIn(body)).toEqual([
				"bangkok-open",
				"closed",
				"nationwide-open",
				"no-salary",
			]);
		});
	});

	describe("sorting and pagination", () => {
		it("sorts by an allow-listed column, with unpublished values last", async () => {
			const { body } = await list("sortBy=salaryMax&order=DESC").expect(200);
			const seeded = body.data.filter((j: { externalId: string }) =>
				j.externalId.startsWith("e2e-")
			);
			expect(seeded[0].externalId).toBe("e2e-high-salary");
		});

		it("rejects an unknown sort column instead of interpolating it", async () => {
			const { body } = await list("sortBy=password").expect(400);
			expect(body.message).toContain("Cannot sort by");
		});

		it("caps limit at the maximum page size", async () => {
			const { body } = await request(app.getHttpServer())
				.get("/api/v1/jobs?limit=5000")
				.expect(400);
			expect(body.status).toBe("error");
		});

		it("splits results across pages", async () => {
			const first = await request(app.getHttpServer())
				.get("/api/v1/jobs?limit=3&page=1")
				.expect(200);
			const second = await request(app.getHttpServer())
				.get("/api/v1/jobs?limit=3&page=2")
				.expect(200);

			expect(first.body.data).toHaveLength(3);
			expect(first.body.meta.limit).toBe(3);
			const firstIds = first.body.data.map((j: { id: string }) => j.id);
			const secondIds = second.body.data.map((j: { id: string }) => j.id);
			expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
		});
	});
});

describe("GET /api/v1/jobs/:id", () => {
	let jobId: string;

	beforeAll(async () => {
		await dataSource.getRepository(Job).delete({ agency: "e2e-detail-fixture" });

		const job = await dataSource.getRepository(Job).save(
			dataSource.getRepository(Job).create({
				source: JobSource.OCSC,
				externalId: "e2e-detail",
				title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
				agency: "e2e-detail-fixture",
				sourceUrl: "https://job.ocsc.go.th/portal/jobs/11232",
				applyUrl: "https://m-society.thaijobjob.com",
				contentHash: "e2e-detail",
				educationRequirements: "ได้รับปริญญาตรีหรือคุณวุฒิอย่างอื่นที่เทียบได้ในระดับเดียวกัน",
				provinceIds: [2],
				educationLevelIds: [8],
			})
		);
		jobId = job.id;

		await dataSource.getRepository(JobAttachment).save({
			jobId,
			name: "ประกาศรับสมัคร",
			url: "https://job.ocsc.go.th/upload2/job-10957.pdf",
		});
	}, 60_000);

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(JobAttachment).delete({ jobId });
			await dataSource.getRepository(Job).delete({ agency: "e2e-detail-fixture" });
		}
	});

	it("returns the announcement with its attachments and both source links", async () => {
		const { body } = await request(app.getHttpServer())
			.get(`/api/v1/jobs/${jobId}`)
			.expect(200);

		expect(body.data).toMatchObject({
			id: jobId,
			title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
			// The human page, so a user can always verify the original.
			sourceUrl: "https://job.ocsc.go.th/portal/jobs/11232",
			// Where applications are actually submitted — a different site.
			applyUrl: "https://m-society.thaijobjob.com",
		});
		expect(body.data.attachments).toHaveLength(1);
		expect(body.data.attachments[0].url).toMatch(/\.pdf$/);
	});

	it("404s for a well-formed id that does not exist", async () => {
		const { body } = await request(app.getHttpServer())
			.get("/api/v1/jobs/00000000-0000-4000-8000-000000000000")
			.expect(404);
		expect(body.status).toBe("error");
	});

	it("400s for an id that is not a uuid", async () => {
		await request(app.getHttpServer()).get("/api/v1/jobs/not-a-uuid").expect(400);
	});
});

describe("GET /api/v1/reference", () => {
	it("returns every taxonomy the filter UI needs, in both languages", async () => {
		const { body } = await request(app.getHttpServer())
			.get("/api/v1/reference")
			.expect(200);

		expect(body.data.provinces).toHaveLength(77);
		expect(body.data.educationLevels).toHaveLength(12);
		expect(body.data.jobTypes).toHaveLength(12);
		expect(body.data.jobCategories).toHaveLength(3);

		expect(body.data.provinces[1]).toEqual({
			id: 2,
			nameTh: "กรุงเทพมหานคร",
			nameEn: "Bangkok",
		});
	});

	it("keeps the source's own ordering", async () => {
		const { body } = await request(app.getHttpServer())
			.get("/api/v1/reference")
			.expect(200);
		expect(body.data.provinces[0].nameTh).toBe("กระบี่");
	});
});

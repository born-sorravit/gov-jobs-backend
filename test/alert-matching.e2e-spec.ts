import { AppModule } from "@/app.module";
import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { User } from "@/models/users/entities/user.entity";
import { AlertMatchingService } from "@/modules/job-alerts/alert-matching.service";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { JobSource } from "@/shared/enums/job-source.enum";
import { UserRole } from "@/shared/enums/user-role.enum";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource, In, Like } from "typeorm";

/**
 * The matching engine against real SQL.
 *
 * Every assertion here is about a rule that only exists in the query — array overlap, the
 * nationwide wildcard, null position types, the `match_from` floor — so mocking the
 * repository would test nothing.
 */
const DOMAIN = "@matching-e2e.test";
const AGENCY = "matching-e2e-fixture";

const BANGKOK = 2;
const CHIANG_MAI = 14;
const BACHELOR = 8;
const VOCATIONAL = 3;
const TYPE_ACADEMIC = 2;
const TYPE_GENERAL = 1;

describe("alert matching", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let matching: AlertMatchingService;
	let userId: string;

	/** An announcement with sensible defaults, first seen now unless told otherwise. */
	const makeJob = async (overrides: Partial<Job> = {}): Promise<Job> => {
		const repo = dataSource.getRepository(Job);
		return repo.save(
			repo.create({
				source: JobSource.OCSC,
				externalId: `match-${Math.random().toString(36).slice(2)}`,
				title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
				agency: AGENCY,
				jobTypeId: TYPE_ACADEMIC,
				provinceIds: [BANGKOK],
				educationLevelIds: [BACHELOR],
				sourceUrl: "https://job.ocsc.go.th/portal/jobs/1",
				contentHash: Math.random().toString(36),
				firstSeenAt: new Date(),
				...overrides,
			})
		);
	};

	const makeAlert = async (overrides: Partial<JobAlert> = {}): Promise<JobAlert> => {
		const repo = dataSource.getRepository(JobAlert);
		return repo.save(
			repo.create({
				userId,
				name: "การแจ้งเตือนทดสอบ",
				keywords: [],
				jobTypes: [],
				educations: [],
				provinces: [],
				notificationEmail: `owner${DOMAIN}`,
				frequency: AlertFrequency.IMMEDIATE,
				isActive: true,
				// An hour ago, so a job created "now" is comfortably after the floor.
				matchFrom: new Date(Date.now() - 3_600_000),
				...overrides,
			})
		);
	};

	const matches = async (job: Job, alert: JobAlert): Promise<boolean> => {
		const found = await matching.findMatchingAlerts(job);
		return found.some((entry) => entry.id === alert.id);
	};

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();
		app = moduleRef.createNestApplication();
		await app.init();
		dataSource = app.get(DataSource);
		matching = app.get(AlertMatchingService);

		const user = await dataSource.getRepository(User).save(
			dataSource.getRepository(User).create({
				email: `owner${DOMAIN}`,
				passwordHash: "x",
				name: "เจ้าของ",
				role: UserRole.USER,
			})
		);
		userId = user.id;
	}, 60_000);

	afterEach(async () => {
		const alerts = await dataSource
			.getRepository(JobAlert)
			.find({ where: { userId }, select: { id: true } });
		if (alerts.length > 0) {
			await dataSource
				.getRepository(JobAlertMatch)
				.delete({ jobAlertId: In(alerts.map((a) => a.id)) });
		}
		await dataSource.getRepository(JobAlert).delete({ userId });
		await dataSource.getRepository(Job).delete({ agency: AGENCY });
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(RefreshToken).delete({ userId });
			await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
		}
		await app?.close();
	});

	describe("keywords", () => {
		it("matches a keyword that is a prefix of the title", async () => {
			// The spec's own example: Thai has no word boundaries, so this must be a substring
			// match, not a word match.
			const alert = await makeAlert({ keywords: ["นักวิชาการคอมพิวเตอร์"] });
			const job = await makeJob({ title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ" });

			expect(await matches(job, alert)).toBe(true);
		});

		it("ORs multiple keywords", async () => {
			const alert = await makeAlert({
				keywords: ["นักวิชาการสารสนเทศ", "นักพัฒนาระบบ"],
			});
			const job = await makeJob({ title: "นักพัฒนาระบบงานคอมพิวเตอร์" });

			expect(await matches(job, alert)).toBe(true);
		});

		it("does not match when no keyword appears", async () => {
			const alert = await makeAlert({ keywords: ["นักบัญชี"] });
			const job = await makeJob({ title: "วิศวกรโยธา" });

			expect(await matches(job, alert)).toBe(false);
		});

		it("matches the agency name too", async () => {
			const alert = await makeAlert({ keywords: ["กระทรวงสาธารณสุข"] });
			const job = await makeJob({ title: "นิติกร", agency: "กระทรวงสาธารณสุข" });

			expect(await matches(job, alert)).toBe(true);
			await dataSource.getRepository(Job).delete({ agency: "กระทรวงสาธารณสุข" });
		});

		it("an empty keyword list places no constraint", async () => {
			const alert = await makeAlert({ keywords: [] });
			const job = await makeJob({ title: "อะไรก็ได้" });

			expect(await matches(job, alert)).toBe(true);
		});

		it("treats % and _ as literal characters, not wildcards", async () => {
			// Unescaped, "%" would match every announcement in the database.
			const alert = await makeAlert({ keywords: ["100%"] });
			const job = await makeJob({ title: "เจ้าหน้าที่ธุรการ" });

			expect(await matches(job, alert)).toBe(false);

			const literal = await makeJob({ title: "ทำงาน 100% ที่บ้าน" });
			expect(await matches(literal, alert)).toBe(true);
		});
	});

	describe("filters", () => {
		it("matches when the position type is one of the selected", async () => {
			const alert = await makeAlert({ jobTypes: [TYPE_ACADEMIC, TYPE_GENERAL] });
			const job = await makeJob({ jobTypeId: TYPE_ACADEMIC });

			expect(await matches(job, alert)).toBe(true);
		});

		it("does not match a position type outside the selection", async () => {
			const alert = await makeAlert({ jobTypes: [TYPE_GENERAL] });
			const job = await makeJob({ jobTypeId: TYPE_ACADEMIC });

			expect(await matches(job, alert)).toBe(false);
		});

		it("treats an unspecified position type as matching any type filter", async () => {
			// `ARRAY[NULL]` makes an overlap NULL rather than false, which would collapse the
			// whole condition — the null is handled explicitly instead.
			const alert = await makeAlert({ jobTypes: [TYPE_GENERAL] });
			const job = await makeJob({ jobTypeId: null });

			expect(await matches(job, alert)).toBe(true);
		});

		it("matches on education overlap", async () => {
			const alert = await makeAlert({ educations: [BACHELOR] });
			const job = await makeJob({ educationLevelIds: [VOCATIONAL, BACHELOR] });

			expect(await matches(job, alert)).toBe(true);
		});

		it("does not match when no education overlaps", async () => {
			const alert = await makeAlert({ educations: [VOCATIONAL] });
			const job = await makeJob({ educationLevelIds: [BACHELOR] });

			expect(await matches(job, alert)).toBe(false);
		});

		it("matches on province overlap", async () => {
			const alert = await makeAlert({ provinces: [BANGKOK] });
			const job = await makeJob({ provinceIds: [BANGKOK, CHIANG_MAI] });

			expect(await matches(job, alert)).toBe(true);
		});

		it("sends a nationwide announcement to every province filter", async () => {
			// The same rule the jobs API applies: no province listed means open to everyone.
			const alert = await makeAlert({ provinces: [CHIANG_MAI] });
			const job = await makeJob({ provinceIds: [] });

			expect(await matches(job, alert)).toBe(true);
		});

		it("ANDs across dimensions", async () => {
			const alert = await makeAlert({
				keywords: ["นักวิชาการคอมพิวเตอร์"],
				jobTypes: [TYPE_ACADEMIC],
				educations: [BACHELOR],
				provinces: [BANGKOK],
			});

			expect(await matches(await makeJob(), alert)).toBe(true);
			// One dimension wrong is enough to exclude it.
			expect(
				await matches(await makeJob({ educationLevelIds: [VOCATIONAL] }), alert)
			).toBe(false);
		});
	});

	describe("the match_from floor", () => {
		it("ignores announcements discovered before the alert existed", async () => {
			// Without this, creating an alert would email the entire back catalogue.
			const alert = await makeAlert({ matchFrom: new Date() });
			const job = await makeJob({ firstSeenAt: new Date(Date.now() - 86_400_000) });

			expect(await matches(job, alert)).toBe(false);
		});

		it("matches announcements discovered after it", async () => {
			const alert = await makeAlert({ matchFrom: new Date(Date.now() - 60_000) });
			const job = await makeJob({ firstSeenAt: new Date() });

			expect(await matches(job, alert)).toBe(true);
		});
	});

	describe("active state", () => {
		it("skips a paused alert", async () => {
			const alert = await makeAlert({ isActive: false });
			const job = await makeJob();

			expect(await matches(job, alert)).toBe(false);
		});
	});

	describe("recording matches", () => {
		it("records one row per matching alert", async () => {
			const alert = await makeAlert({ keywords: ["นักวิชาการคอมพิวเตอร์"] });
			const job = await makeJob();

			await matching.matchJobs([job.id]);

			const rows = await dataSource
				.getRepository(JobAlertMatch)
				.find({ where: { jobAlertId: alert.id } });
			expect(rows).toHaveLength(1);
			// Delivery is step 11's; matching only records that the pair exists.
			expect(rows[0].notifiedAt).toBeNull();
		});

		it("never records the same announcement twice for one alert", async () => {
			const alert = await makeAlert({ keywords: ["นักวิชาการคอมพิวเตอร์"] });
			const job = await makeJob();

			await matching.matchJobs([job.id]);
			// Re-running must be free: this is what stops a duplicate notification.
			expect(await matching.matchJobs([job.id])).toEqual([]);

			const rows = await dataSource
				.getRepository(JobAlertMatch)
				.find({ where: { jobAlertId: alert.id } });
			expect(rows).toHaveLength(1);
		});

		it("records nothing when given no announcements", async () => {
			await makeAlert();
			expect(await matching.matchJobs([])).toEqual([]);
		});

		it("records a match for every alert an announcement satisfies", async () => {
			await makeAlert({ name: "ก", keywords: ["นักวิชาการ"] });
			await makeAlert({ name: "ข", provinces: [BANGKOK] });
			await makeAlert({ name: "ค", keywords: ["ไม่ตรงเลย"] });

			const job = await makeJob();

			await matching.matchJobs([job.id]);

			// Two of the three alerts match; the third's keyword does not appear. Counted per
			// alert because e2e files share one database.
			const mine = await dataSource
				.getRepository(JobAlert)
				.find({ where: { userId } });
			const counts = await Promise.all(
				mine.map((entry) =>
					dataSource
						.getRepository(JobAlertMatch)
						.count({ where: { jobAlertId: entry.id, jobId: job.id } })
				)
			);
			expect(counts.filter((count) => count > 0)).toHaveLength(2);
		});
	});
});

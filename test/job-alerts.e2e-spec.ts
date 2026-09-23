import { AppModule } from "@/app.module";
import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { User } from "@/models/users/entities/user.entity";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, In, Like } from "typeorm";

const DOMAIN = "@alerts-e2e.test";

describe("job alerts", () => {
	let app: INestApplication;
	let dataSource: DataSource;

	const signUp = async (name: string): Promise<string> => {
		const { body } = await request(app.getHttpServer())
			.post("/api/v1/auth/register")
			.send({
				email: `${name}${DOMAIN}`,
				password: "correct-horse-battery",
				name: "ผู้ทดสอบ",
			})
			.expect(201);
		return body.data.accessToken as string;
	};

	const api = (token: string) => {
		const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
		return {
			get: (p: string) => auth(request(app.getHttpServer()).get(`/api/v1${p}`)),
			post: (p: string, body?: object) =>
				auth(request(app.getHttpServer()).post(`/api/v1${p}`)).send(body ?? {}),
			patch: (p: string, body: object) =>
				auth(request(app.getHttpServer()).patch(`/api/v1${p}`)).send(body),
			delete: (p: string) =>
				auth(request(app.getHttpServer()).delete(`/api/v1${p}`)),
		};
	};

	const VALID = {
		name: "งานไอทีในกรุงเทพ",
		keywords: ["นักวิชาการคอมพิวเตอร์"],
		provinces: [2],
	};

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();
		app = moduleRef.createNestApplication();
		app.setGlobalPrefix("api", { exclude: ["healthcheck"] });
		app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
		app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
		app.useGlobalInterceptors(new ResponseFormatInterceptor());
		app.useGlobalFilters(new GlobalExceptionFilter());
		await app.init();
		dataSource = app.get(DataSource);
	}, 60_000);

	afterEach(async () => {
		const users = await dataSource
			.getRepository(User)
			.find({ where: { email: Like(`%${DOMAIN}`) }, select: { id: true } });
		const ids = users.map((u) => u.id);
		if (ids.length > 0) {
			const alerts = await dataSource
				.getRepository(JobAlert)
				.find({ where: { userId: In(ids) }, select: { id: true } });
			if (alerts.length > 0) {
				await dataSource
					.getRepository(JobAlertMatch)
					.delete({ jobAlertId: In(alerts.map((a) => a.id)) });
			}
			await dataSource.getRepository(JobAlert).delete({ userId: In(ids) });
			await dataSource.getRepository(RefreshToken).delete({ userId: In(ids) });
		}
		await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
	});

	afterAll(async () => {
		await app?.close();
	});

	describe("authorisation", () => {
		it("rejects listing without a token", async () => {
			await request(app.getHttpServer()).get("/api/v1/job-alerts").expect(401);
		});

		it("hides another user's alert behind a 404, not a 403", async () => {
			const alice = await signUp("alice");
			const bob = await signUp("bob");

			const { body } = await api(alice).post("/job-alerts", VALID).expect(201);

			// A 403 would confirm the id exists; a 404 tells a stranger nothing.
			await api(bob).get(`/job-alerts/${body.data.id}`).expect(404);
			await api(bob)
				.patch(`/job-alerts/${body.data.id}`, { name: "ยึด" })
				.expect(404);
			await api(bob).delete(`/job-alerts/${body.data.id}`).expect(404);
		});
	});

	describe("creating", () => {
		it("creates an alert and defaults the email to the account's", async () => {
			const token = await signUp("creator");

			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			expect(body.data).toMatchObject({
				name: VALID.name,
				keywords: VALID.keywords,
				provinces: [2],
				jobTypes: [],
				educations: [],
				notificationEmail: `creator${DOMAIN}`,
				frequency: "IMMEDIATE",
				isActive: true,
				matchCount: 0,
			});
		});

		/**
		 * The gap this closed: the API used to let a client name any recipient, so anyone could
		 * have a stranger mailed announcements they never asked for and — having no account —
		 * could not stop. The field is gone from the DTO, so `whitelist: true` strips it.
		 */
		it("ignores a notification email supplied by the client", async () => {
			const token = await signUp("recipient");

			const { body } = await api(token)
				.post("/job-alerts", {
					...VALID,
					notificationEmail: `stranger${DOMAIN}`,
				})
				.expect(201);

			expect(body.data.notificationEmail).toBe(`recipient${DOMAIN}`);

			const stored = await dataSource
				.getRepository(JobAlert)
				.findOneByOrFail({ id: body.data.id });
			expect(stored.notificationEmail).toBe(`recipient${DOMAIN}`);
		});

		it("cannot be redirected to a stranger by a later edit either", async () => {
			const token = await signUp("noredirect");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			await api(token)
				.patch(`/job-alerts/${body.data.id}`, {
					notificationEmail: `stranger${DOMAIN}`,
				})
				.expect(200);

			const stored = await dataSource
				.getRepository(JobAlert)
				.findOneByOrFail({ id: body.data.id });
			expect(stored.notificationEmail).toBe(`noredirect${DOMAIN}`);
		});

		it("gives every alert an unsubscribe token", async () => {
			const token = await signUp("token");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			const stored = await dataSource
				.getRepository(JobAlert)
				.findOneByOrFail({ id: body.data.id });

			expect(stored.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
			// Never exposed to the client — it is a bearer secret, and the owner does not need
			// it to manage their own alert.
			expect(body.data).not.toHaveProperty("unsubscribeToken");
		});

		it("sets the matching floor to now, so the archive is never replayed", async () => {
			const token = await signUp("floor");
			const before = Date.now();

			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			const matchFrom = Date.parse(body.data.matchFrom);
			expect(matchFrom).toBeGreaterThanOrEqual(before - 1000);
			expect(matchFrom).toBeLessThanOrEqual(Date.now() + 1000);
		});

		it("de-duplicates and trims keywords", async () => {
			const token = await signUp("keywords");

			const { body } = await api(token)
				.post("/job-alerts", { name: "ทดสอบ", keywords: [" นักบัญชี ", "นักบัญชี", ""] })
				.expect(201);

			expect(body.data.keywords).toEqual(["นักบัญชี"]);
		});

		it.each([
			["a missing name", { name: "" }],
			["an unknown frequency", { frequency: "HOURLY" }],
			[
				"too many keywords",
				{ keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) },
			],
		])("rejects %s", async (_label, override) => {
			const token = await signUp("invalid");
			await api(token)
				.post("/job-alerts", { ...VALID, ...override })
				.expect(400);
		});
	});

	describe("listing and reading", () => {
		it("lists only the signed-in user's alerts", async () => {
			const alice = await signUp("alice");
			const bob = await signUp("bob");
			await api(alice).post("/job-alerts", VALID).expect(201);

			const mine = await api(alice).get("/job-alerts").expect(200);
			const theirs = await api(bob).get("/job-alerts").expect(200);

			expect(mine.body.data).toHaveLength(1);
			expect(theirs.body.data).toEqual([]);
		});

		it("404s for an alert that does not exist", async () => {
			const token = await signUp("missing");
			await api(token)
				.get("/job-alerts/00000000-0000-4000-8000-000000000000")
				.expect(404);
		});
	});

	describe("editing", () => {
		it("applies a partial update and leaves the rest alone", async () => {
			const token = await signUp("editor");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			const updated = await api(token)
				.patch(`/job-alerts/${body.data.id}`, { name: "ชื่อใหม่" })
				.expect(200);

			expect(updated.body.data.name).toBe("ชื่อใหม่");
			expect(updated.body.data.keywords).toEqual(VALID.keywords);
		});

		it("does not move the matching floor", async () => {
			const token = await signUp("floor-editor");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			await new Promise((resolve) => setTimeout(resolve, 1100));
			const updated = await api(token)
				.patch(`/job-alerts/${body.data.id}`, { keywords: ["อะไรก็ได้"] })
				.expect(200);

			// Editing must never be usable as a way to replay announcements already recorded.
			expect(updated.body.data.matchFrom).toBe(body.data.matchFrom);
		});
	});

	describe("pause and resume", () => {
		it("pauses without deleting", async () => {
			const token = await signUp("pauser");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			const paused = await api(token)
				.post(`/job-alerts/${body.data.id}/pause`)
				.expect(200);
			expect(paused.body.data.isActive).toBe(false);

			await api(token).get(`/job-alerts/${body.data.id}`).expect(200);
		});

		it("resuming moves the floor forward, so nothing missed is reported", async () => {
			const token = await signUp("resumer");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			await api(token).post(`/job-alerts/${body.data.id}/pause`).expect(200);
			await new Promise((resolve) => setTimeout(resolve, 1100));
			const resumed = await api(token)
				.post(`/job-alerts/${body.data.id}/resume`)
				.expect(200);

			expect(resumed.body.data.isActive).toBe(true);
			expect(Date.parse(resumed.body.data.matchFrom)).toBeGreaterThan(
				Date.parse(body.data.matchFrom)
			);
		});
	});

	describe("deleting", () => {
		it("deletes the alert", async () => {
			const token = await signUp("deleter");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			await api(token).delete(`/job-alerts/${body.data.id}`).expect(200);
			await api(token).get(`/job-alerts/${body.data.id}`).expect(404);
		});

		it("takes its recorded matches with it", async () => {
			const token = await signUp("cascade");
			const { body } = await api(token).post("/job-alerts", VALID).expect(201);

			const job = await dataSource.getRepository("job").findOne({ where: {} });
			await dataSource
				.getRepository(JobAlertMatch)
				.insert({ jobAlertId: body.data.id, jobId: (job as { id: string }).id });

			await api(token).delete(`/job-alerts/${body.data.id}`).expect(200);

			const left = await dataSource
				.getRepository(JobAlertMatch)
				.count({ where: { jobAlertId: body.data.id } });
			expect(left).toBe(0);
		});
	});
});

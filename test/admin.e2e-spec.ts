import { AppModule } from "@/app.module";
import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { User } from "@/models/users/entities/user.entity";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { UserRole } from "@/shared/enums/user-role.enum";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, Like } from "typeorm";

const DOMAIN = "@admin-e2e.test";
const ENDPOINTS = [
	"/admin/overview",
	"/admin/crawler-runs",
	"/admin/users",
	"/admin/alerts",
	"/admin/email-logs",
];

describe("admin", () => {
	let app: INestApplication;
	let dataSource: DataSource;

	const signUp = async (name: string): Promise<{ token: string; id: string }> => {
		const { body } = await request(app.getHttpServer())
			.post("/api/v1/auth/register")
			.send({
				email: `${name}${DOMAIN}`,
				password: "correct-horse-battery",
				name: "ผู้ทดสอบ",
			})
			.expect(201);
		return { token: body.data.accessToken, id: body.data.user.id };
	};

	const get = (path: string, token?: string) => {
		const req = request(app.getHttpServer()).get(`/api/v1${path}`);
		return token ? req.set("Authorization", `Bearer ${token}`) : req;
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
		for (const user of users) {
			await dataSource.getRepository(RefreshToken).delete({ userId: user.id });
		}
		await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
	});

	afterAll(async () => {
		await app?.close();
	});

	describe("the role gate", () => {
		it.each(ENDPOINTS)("rejects %s with no token", async (path) => {
			await get(path).expect(401);
		});

		it.each(ENDPOINTS)("rejects %s for an ordinary account", async (path) => {
			const { token } = await signUp("ordinary");
			// 403, not 404: the caller is authenticated, just not permitted.
			await get(path, token).expect(403);
		});

		it("lets an admin through", async () => {
			const { token, id } = await signUp("boss");
			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });

			for (const path of ENDPOINTS) {
				await get(path, token).expect(200);
			}
		});

		it("acts on the database role, not the one baked into the token", async () => {
			const { token, id } = await signUp("promoted");
			// The token was minted as USER and still says so.
			await get("/admin/overview", token).expect(403);

			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });
			// Promotion takes effect immediately, without waiting for the token to rotate.
			await get("/admin/overview", token).expect(200);

			await dataSource.getRepository(User).update(id, { role: UserRole.USER });
			// And so does demotion — the important direction.
			await get("/admin/overview", token).expect(403);
		});
	});

	describe("overview", () => {
		it("reports the headline counts and crawler health", async () => {
			const { token, id } = await signUp("viewer");
			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });

			const { body } = await get("/admin/overview", token).expect(200);

			expect(body.data).toMatchObject({
				users: expect.any(Number),
				admins: expect.any(Number),
				jobs: expect.any(Number),
				openJobs: expect.any(Number),
				alerts: expect.any(Number),
				pendingNotifications: expect.any(Number),
				emailsSent: expect.any(Number),
				consecutiveFailures: expect.any(Number),
			});
			expect(body.data.jobs).toBeGreaterThan(0);
			expect(body.data.admins).toBeGreaterThanOrEqual(1);
		});
	});

	describe("listings", () => {
		it("paginates and never exposes a password hash", async () => {
			const { token, id } = await signUp("lister");
			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });

			const { body } = await get("/admin/users?limit=1", token).expect(200);

			expect(body.data).toHaveLength(1);
			expect(body.meta.limit).toBe(1);
			expect(body.data[0]).not.toHaveProperty("passwordHash");
			expect(body.data[0]).toMatchObject({
				email: expect.any(String),
				role: expect.any(String),
				alertCount: expect.any(Number),
				savedJobCount: expect.any(Number),
			});
		});

		it("shows crawl history with its durations and errors", async () => {
			const { token, id } = await signUp("historian");
			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });

			const { body } = await get("/admin/crawler-runs?limit=5", token).expect(200);

			expect(Array.isArray(body.data)).toBe(true);
			for (const run of body.data) {
				expect(run).toHaveProperty("status");
				expect(run).toHaveProperty("totalFound");
				expect(run).toHaveProperty("errorMessage");
			}
		});

		it("rejects an unknown sort column", async () => {
			const { token, id } = await signUp("sorter");
			await dataSource.getRepository(User).update(id, { role: UserRole.ADMIN });

			await get("/admin/users?sortBy=passwordHash", token).expect(400);
		});
	});
});

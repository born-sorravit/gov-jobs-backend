import { AppModule } from "@/app.module";
import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { SavedJob } from "@/models/saved-jobs/entities/saved-job.entity";
import { User } from "@/models/users/entities/user.entity";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, Like } from "typeorm";

const DOMAIN = "@saved-e2e.test";

describe("saved jobs", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let jobIds: string[] = [];

	/** Signs up a fresh account and returns its bearer token. */
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

	const authed = (token: string) => ({
		get: (path: string) =>
			request(app.getHttpServer())
				.get(`/api/v1${path}`)
				.set("Authorization", `Bearer ${token}`),
		post: (path: string) =>
			request(app.getHttpServer())
				.post(`/api/v1${path}`)
				.set("Authorization", `Bearer ${token}`),
		delete: (path: string) =>
			request(app.getHttpServer())
				.delete(`/api/v1${path}`)
				.set("Authorization", `Bearer ${token}`),
	});

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

		// Real crawled announcements — saving is a join, so the rows just have to exist.
		const jobs = await dataSource
			.getRepository(Job)
			.find({ take: 3, select: { id: true } });
		jobIds = jobs.map((job) => job.id);
		expect(jobIds.length).toBe(3);
	}, 60_000);

	afterEach(async () => {
		const users = await dataSource
			.getRepository(User)
			.find({ where: { email: Like(`%${DOMAIN}`) }, select: { id: true } });
		for (const user of users) {
			await dataSource.getRepository(SavedJob).delete({ userId: user.id });
			await dataSource.getRepository(RefreshToken).delete({ userId: user.id });
		}
		await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
	});

	afterAll(async () => {
		await app?.close();
	});

	describe("authorisation", () => {
		it.each([
			["GET", "/saved-jobs"],
			["GET", "/saved-jobs/ids"],
		])("rejects %s %s without a token", async (method, path) => {
			await request(app.getHttpServer())
				[method.toLowerCase() as "get"](`/api/v1${path}`)
				.expect(401);
		});

		it("rejects saving without a token", async () => {
			await request(app.getHttpServer())
				.post(`/api/v1/saved-jobs/${jobIds[0]}`)
				.expect(401);
		});

		it("never shows one user's saved jobs to another", async () => {
			const alice = await signUp("alice");
			const bob = await signUp("bob");

			await authed(alice).post(`/saved-jobs/${jobIds[0]}`).expect(200);

			const { body } = await authed(bob).get("/saved-jobs").expect(200);
			expect(body.data).toEqual([]);
		});
	});

	describe("saving", () => {
		it("saves an announcement and lists it back", async () => {
			const token = await signUp("saver");

			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);

			const { body } = await authed(token).get("/saved-jobs").expect(200);
			expect(body.data).toHaveLength(1);
			expect(body.data[0]).toMatchObject({ id: jobIds[0] });
			// The list is job data plus when *this* user saved it.
			expect(body.data[0].savedAt).toEqual(expect.any(String));
			expect(body.data[0].title).toEqual(expect.any(String));
		});

		it("is idempotent — saving twice is still one row", async () => {
			const token = await signUp("twice");

			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);
			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);

			const { body } = await authed(token).get("/saved-jobs").expect(200);
			expect(body.data).toHaveLength(1);
		});

		it("404s for an announcement that does not exist", async () => {
			const token = await signUp("missing");
			await authed(token)
				.post("/saved-jobs/00000000-0000-4000-8000-000000000000")
				.expect(404);
		});

		it("400s for an id that is not a uuid", async () => {
			const token = await signUp("malformed");
			await authed(token).post("/saved-jobs/not-a-uuid").expect(400);
		});
	});

	describe("removing", () => {
		it("removes a saved announcement", async () => {
			const token = await signUp("remover");
			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);

			await authed(token).delete(`/saved-jobs/${jobIds[0]}`).expect(200);

			const { body } = await authed(token).get("/saved-jobs").expect(200);
			expect(body.data).toEqual([]);
		});

		it("is idempotent — removing something never saved still succeeds", async () => {
			const token = await signUp("never-saved");
			// A 404 here would make an optimistic toggle flicker back on a double-click.
			await authed(token).delete(`/saved-jobs/${jobIds[0]}`).expect(200);
		});

		it("lets the same announcement be saved again afterwards", async () => {
			const token = await signUp("re-saver");

			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);
			await authed(token).delete(`/saved-jobs/${jobIds[0]}`).expect(200);
			// The removal has to be a hard delete: `uq_saved_job_user_job` carries no
			// `WHERE deleted_at IS NULL`, so a soft-deleted row would block this forever.
			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);

			const { body } = await authed(token).get("/saved-jobs").expect(200);
			expect(body.data).toHaveLength(1);
		});
	});

	describe("ids", () => {
		it("returns just the ids, for marking a public job list", async () => {
			const token = await signUp("marker");
			await authed(token).post(`/saved-jobs/${jobIds[0]}`).expect(200);
			await authed(token).post(`/saved-jobs/${jobIds[1]}`).expect(200);

			const { body } = await authed(token).get("/saved-jobs/ids").expect(200);

			expect(new Set(body.data)).toEqual(new Set([jobIds[0], jobIds[1]]));
		});

		it("is empty for a new account", async () => {
			const token = await signUp("fresh");
			const { body } = await authed(token).get("/saved-jobs/ids").expect(200);
			expect(body.data).toEqual([]);
		});

		it("is not shadowed by the :jobId routes", async () => {
			// `ids` is a valid string for a uuid param, so declaration order decides whether
			// this route is reachable at all.
			const token = await signUp("routing");
			await authed(token).get("/saved-jobs/ids").expect(200);
		});
	});

	describe("pagination and sorting", () => {
		it("paginates", async () => {
			const token = await signUp("paginator");
			for (const id of jobIds) {
				await authed(token).post(`/saved-jobs/${id}`).expect(200);
			}

			const { body } = await authed(token)
				.get("/saved-jobs?limit=2&page=1")
				.expect(200);
			expect(body.data).toHaveLength(2);
			expect(body.meta).toMatchObject({ total: 3, last_page: 2, limit: 2 });
		});

		it("rejects an unknown sort column", async () => {
			const token = await signUp("sorter");
			await authed(token).get("/saved-jobs?sortBy=passwordHash").expect(400);
		});
	});
});

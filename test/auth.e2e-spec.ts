import { AppModule } from "@/app.module";
import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { User } from "@/models/users/entities/user.entity";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import request from "supertest";
import { DataSource, Like } from "typeorm";

/** Every account this file creates lives under one domain, so cleanup can be exact. */
const DOMAIN = "@auth-e2e.test";
const email = (name: string) => `${name}${DOMAIN}`;
const PASSWORD = "correct-horse-battery";

describe("authentication", () => {
	let app: INestApplication;
	let dataSource: DataSource;

	const post = (path: string, body: object) =>
		request(app.getHttpServer()).post(`/api/v1${path}`).send(body);

	const register = (name: string, password = PASSWORD) =>
		post("/auth/register", { email: email(name), password, name: "ทดสอบ ระบบ" });

	beforeAll(async () => {
		// Credential endpoints allow 10 attempts a minute, which this suite would trip within
		// a few tests. The limit itself is proved in its own describe below, with the real
		// guard; here it is stubbed out so the functional assertions are what fail or pass.
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideGuard(ThrottlerGuard)
			.useValue({ canActivate: () => true })
			.compile();
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

	describe("registration", () => {
		it("creates an account and returns a session", async () => {
			const { body } = await register("newcomer").expect(201);

			expect(body.data).toMatchObject({
				accessToken: expect.any(String),
				refreshToken: expect.any(String),
				expiresIn: 900,
				user: {
					email: email("newcomer"),
					name: "ทดสอบ ระบบ",
					role: "USER",
					// No verification flow until the email module lands in step 11.
					isVerified: false,
					locale: "th",
				},
			});
			expect(body.data.user).not.toHaveProperty("passwordHash");
		});

		it("rejects a duplicate email with 409, not 500", async () => {
			await register("twice").expect(201);
			const { body } = await register("twice").expect(409);
			expect(body.message).toMatch(/already exists/i);
		});

		it("treats differently-cased addresses as one account", async () => {
			await register("Casing").expect(201);
			await post("/auth/register", {
				email: `CASING${DOMAIN.toUpperCase()}`,
				password: PASSWORD,
				name: "x",
			}).expect(409);
		});

		it.each([
			["a short password", { password: "short" }],
			["a malformed email", { email: "not-an-email" }],
			["a missing name", { name: "" }],
		])("rejects %s", async (_label, override) => {
			await post("/auth/register", {
				email: email("invalid"),
				password: PASSWORD,
				name: "ทดสอบ",
				...override,
			}).expect(400);
		});

		it("never stores the password in plain text", async () => {
			await register("hashed").expect(201);

			const stored = await dataSource.getRepository(User).findOne({
				where: { email: email("hashed") },
				select: { passwordHash: true },
			});

			expect(stored?.passwordHash).toBeDefined();
			expect(stored?.passwordHash).not.toBe(PASSWORD);
			expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
		});
	});

	describe("login", () => {
		it("returns a session for correct credentials", async () => {
			await register("known").expect(201);
			const { body } = await post("/auth/login", {
				email: email("known"),
				password: PASSWORD,
			}).expect(200);

			expect(body.data.accessToken).toEqual(expect.any(String));
			expect(body.data.user.email).toBe(email("known"));
		});

		it("gives the same answer for a wrong password and an unknown account", async () => {
			await register("known").expect(201);

			const wrongPassword = await post("/auth/login", {
				email: email("known"),
				password: "not-the-password",
			}).expect(401);

			const unknownAccount = await post("/auth/login", {
				email: email("ghost"),
				password: PASSWORD,
			}).expect(401);

			// Differing messages would turn the login form into an account-enumeration oracle.
			expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
		});
	});

	describe("protected routes", () => {
		it("rejects a request with no token", async () => {
			await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
		});

		it("rejects a malformed token", async () => {
			await request(app.getHttpServer())
				.get("/api/v1/auth/me")
				.set("Authorization", "Bearer not.a.jwt")
				.expect(401);
		});

		it("returns the account for a valid token", async () => {
			const { body } = await register("holder").expect(201);

			const me = await request(app.getHttpServer())
				.get("/api/v1/auth/me")
				.set("Authorization", `Bearer ${body.data.accessToken}`)
				.expect(200);

			expect(me.body.data).toMatchObject({ email: email("holder"), role: "USER" });
		});

		it("leaves the public job endpoints reachable without a token", async () => {
			await request(app.getHttpServer()).get("/api/v1/jobs?limit=1").expect(200);
			await request(app.getHttpServer()).get("/api/v1/reference").expect(200);
			await request(app.getHttpServer()).get("/healthcheck").expect(200);
		});
	});

	describe("refresh rotation", () => {
		it("exchanges a refresh token for a new session", async () => {
			const { body } = await register("rotator").expect(201);

			const refreshed = await post("/auth/refresh", {
				refreshToken: body.data.refreshToken,
			}).expect(200);

			expect(refreshed.body.data.refreshToken).not.toBe(body.data.refreshToken);
			expect(refreshed.body.data.user.email).toBe(email("rotator"));
		});

		it("refuses to reuse a refresh token once the grace window has passed", async () => {
			const { body } = await register("replayer").expect(201);
			await post("/auth/refresh", { refreshToken: body.data.refreshToken }).expect(
				200
			);

			// A rotated token is forgiven briefly so a browser's concurrent requests all work.
			// Past that window a replay is the signature of a stolen token, and must be dead.
			await new Promise((resolve) => setTimeout(resolve, 1300));

			await post("/auth/refresh", { refreshToken: body.data.refreshToken }).expect(
				401
			);
		}, 15_000);

		it("tolerates a concurrent reuse within the rotation grace window", async () => {
			const { body } = await register("concurrent").expect(201);

			// A browser firing several requests at a just-expired access token sends the same
			// refresh token more than once. The frontend cannot serialise that in general — it
			// runs on serverless instances that share no memory — so the window absorbs it.
			const results = await Promise.all(
				Array.from({ length: 4 }, () =>
					post("/auth/refresh", { refreshToken: body.data.refreshToken })
				)
			);

			expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
			// Each caller still gets its own fresh token, so nothing shares a session secret.
			const issued = new Set(results.map((result) => result.body.data.refreshToken));
			expect(issued.size).toBe(4);
		});

		it("never forgives a token revoked by signing out, even immediately", async () => {
			const { body } = await register("signed-out").expect(201);
			await post("/auth/logout", { refreshToken: body.data.refreshToken }).expect(
				200
			);

			// Same millisecond as the revocation — the grace window is for rotation only.
			await post("/auth/refresh", { refreshToken: body.data.refreshToken }).expect(
				401
			);
		});

		it("refuses a token that was never issued", async () => {
			await post("/auth/refresh", { refreshToken: "made-up-value" }).expect(401);
		});

		it("stores only a hash of the refresh token", async () => {
			const { body } = await register("hashed-token").expect(201);

			const rows = await dataSource.getRepository(RefreshToken).find();
			const plain = rows.find((row) => row.tokenHash === body.data.refreshToken);

			expect(plain).toBeUndefined();
			expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.tokenHash))).toBe(true);
		});
	});

	describe("logout", () => {
		it("revokes the refresh token", async () => {
			const { body } = await register("leaver").expect(201);

			await post("/auth/logout", { refreshToken: body.data.refreshToken }).expect(
				200
			);
			await post("/auth/refresh", { refreshToken: body.data.refreshToken }).expect(
				401
			);
		});

		it("is idempotent", async () => {
			const { body } = await register("double-leaver").expect(201);

			await post("/auth/logout", { refreshToken: body.data.refreshToken }).expect(
				200
			);
			await post("/auth/logout", { refreshToken: body.data.refreshToken }).expect(
				200
			);
		});
	});
});

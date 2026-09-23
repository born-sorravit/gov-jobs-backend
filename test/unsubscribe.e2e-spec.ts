import { AppModule } from "@/app.module";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { User } from "@/models/users/entities/user.entity";
import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { INestApplication, ValidationPipe, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource, Like } from "typeorm";

const DOMAIN = "@unsub-e2e.test";
const PATH = "/api/v1/alerts/unsubscribe";

/**
 * Switching an alert off from the link in its own email.
 *
 * The property worth an integration test rather than a unit test is that this works with no
 * Authorization header at all — the person who wants the mail to stop may have no account,
 * which is exactly the case the endpoint exists for.
 */
describe("unsubscribe", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let dispatch: NotificationDispatchService;

	const http = () => request(app.getHttpServer());

	const createAlert = async (name: string): Promise<JobAlert> => {
		const { body } = await http()
			.post("/api/v1/auth/register")
			.send({
				email: `${name}${DOMAIN}`,
				password: "correct-horse-battery",
				name: "ผู้ทดสอบ",
			})
			.expect(201);

		const { body: alert } = await http()
			.post("/api/v1/job-alerts")
			.set("Authorization", `Bearer ${body.data.accessToken}`)
			.send({ name: "งานไอที", keywords: ["นักวิชาการคอมพิวเตอร์"] })
			.expect(201);

		return dataSource.getRepository(JobAlert).findOneByOrFail({ id: alert.data.id });
	};

	const reload = (id: string): Promise<JobAlert> =>
		dataSource.getRepository(JobAlert).findOneByOrFail({ id });

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
		dispatch = app.get(NotificationDispatchService);
	}, 60_000);

	afterAll(async () => {
		await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
		await app?.close();
	});

	/**
	 * The trap this endpoint is shaped around. Mail clients, link scanners and corporate
	 * security gateways follow links in email with GET, unprompted — if GET unsubscribed,
	 * a scanner opening the message would silently switch the user's alerts off.
	 */
	it("does not unsubscribe on GET, however many times it is fetched", async () => {
		const alert = await createAlert("prefetch");

		for (let i = 0; i < 3; i += 1) {
			const res = await http()
				.get(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
				.expect(200);
			expect(res.headers["content-type"]).toContain("text/html");
		}

		expect((await reload(alert.id)).isActive).toBe(true);
	});

	it("unsubscribes on POST, with no Authorization header", async () => {
		const alert = await createAlert("oneclick");

		await http()
			.post(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.expect(200);

		expect((await reload(alert.id)).isActive).toBe(false);
	});

	/** RFC 8058: this is the exact body a one-click client sends. */
	it("accepts the one-click form post", async () => {
		const alert = await createAlert("rfc8058");

		await http()
			.post(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.type("form")
			.send("List-Unsubscribe=One-Click")
			.expect(200);

		expect((await reload(alert.id)).isActive).toBe(false);
	});

	/** The confirm page's own submit: token in the body as well as the query. */
	it("accepts the confirmation page's form submit", async () => {
		const alert = await createAlert("formpost");

		await http()
			.post(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.type("form")
			.send(`token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.expect(200);

		expect((await reload(alert.id)).isActive).toBe(false);
	});

	/** And with the token *only* in the body, if a client drops the query string. */
	it("accepts a form submit carrying the token only in the body", async () => {
		const alert = await createAlert("bodyonly");

		await http()
			.post(PATH)
			.type("form")
			.send(`token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.expect(200);

		expect((await reload(alert.id)).isActive).toBe(false);
	});

	it("is idempotent, so a client retrying does not see an error", async () => {
		const alert = await createAlert("retry");
		const url = `${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`;

		await http().post(url).expect(200);
		await http().post(url).expect(200);

		expect((await reload(alert.id)).isActive).toBe(false);
	});

	it("keeps the alert, so the owner does not lose their saved search", async () => {
		const alert = await createAlert("kept");

		await http()
			.post(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.expect(200);

		const stored = await reload(alert.id);
		expect(stored.name).toBe("งานไอที");
		expect(stored.keywords).toEqual(["นักวิชาการคอมพิวเตอร์"]);
	});

	/** A 400 would tell a prober their guess was well-formed. Everything unusable is a 404. */
	it.each([
		["an unknown token", "?token=definitely-not-a-real-token"],
		["no token at all", ""],
		["an empty token", "?token="],
	])("404s for %s", async (_label, query) => {
		await http().post(`${PATH}${query}`).expect(404);
		await http().get(`${PATH}${query}`).expect(404);
	});

	it("404s for an unknown token in the body", async () => {
		await http().post(PATH).type("form").send("token=nope").expect(404);
	});

	/**
	 * Immediate mail is only half of it. Digests are produced by a different path
	 * (`NotificationDispatchService`), on a schedule rather than off a crawl — and a digest
	 * still arriving after someone clicked unsubscribe is precisely the failure this exists
	 * to prevent.
	 */
	it("stops the digest too, not just immediate mail", async () => {
		const alert = await createAlert("digest");
		await dataSource
			.getRepository(JobAlert)
			.update(alert.id, { frequency: AlertFrequency.DAILY });

		const job = await dataSource.getRepository(Job).findOne({ where: {} });
		if (!job) throw new Error("no announcement in the database to match against");
		await dataSource
			.getRepository(JobAlertMatch)
			.insert({ jobAlertId: alert.id, jobId: job.id });

		// Pending and due while the alert is live.
		expect(await dispatch.dispatchDigests(AlertFrequency.DAILY)).toBeGreaterThan(0);

		await http()
			.post(`${PATH}?token=${encodeURIComponent(alert.unsubscribeToken)}`)
			.expect(200);

		await dataSource
			.getRepository(JobAlertMatch)
			.update({ jobAlertId: alert.id }, { notifiedAt: null });

		expect(await dispatch.dispatchDigests(AlertFrequency.DAILY)).toBe(0);
	});

	it("never lets one person's token touch another person's alert", async () => {
		const mine = await createAlert("mine");
		const theirs = await createAlert("theirs");

		await http()
			.post(`${PATH}?token=${encodeURIComponent(mine.unsubscribeToken)}`)
			.expect(200);

		expect((await reload(theirs.id)).isActive).toBe(true);
	});
});

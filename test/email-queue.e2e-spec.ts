import { AppModule } from "@/app.module";
import { QUEUE_EMAIL_NOTIFICATION } from "@/constants/queue.constants";
import { EmailLog } from "@/models/email/entities/email-log.entity";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { User } from "@/models/users/entities/user.entity";
import { EMAIL_PROVIDER } from "@/modules/email/interfaces/email-provider.interface";
import type {
	EmailMessage,
	EmailProvider,
} from "@/modules/email/interfaces/email-provider.interface";
import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { UserRole } from "@/shared/enums/user-role.enum";
import { getQueueToken } from "@nestjs/bullmq";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Queue } from "bullmq";
import { DataSource, In, IsNull, Like } from "typeorm";

/**
 * The email queue: routing by frequency, digest period keying, and the at-least-once
 * guarantee the README claims.
 *
 * The provider is a controllable stub because the failure branch is unreachable otherwise —
 * `ConsoleEmailProvider` never fails, and it is exactly the failure path that decides whether
 * a user silently misses a job.
 */
const DOMAIN = "@email-e2e.test";

class StubProvider implements EmailProvider {
	readonly name = "stub";
	sent: EmailMessage[] = [];
	failWith: Error | null = null;

	async send(message: EmailMessage) {
		if (this.failWith) throw this.failWith;
		this.sent.push(message);
		return { providerMessageId: `stub-${this.sent.length}` };
	}
}

describe("email queue", () => {
	let app: INestApplication;
	let dataSource: DataSource;
	let dispatch: NotificationDispatchService;
	let queue: Queue;
	let provider: StubProvider;
	let userId: string;
	let jobIds: string[];

	const drain = async (timeoutMs = 30_000): Promise<void> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const counts = await queue.getJobCounts("waiting", "active", "delayed");
			if (
				(counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) ===
				0
			) {
				await new Promise((resolve) => setTimeout(resolve, 400));
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error("email queue did not drain");
	};

	/**
	 * Polls for a condition rather than for an empty queue.
	 *
	 * A failing job sits in `delayed` between retries — 5s, 10s, 20s — so the queue never
	 * drains within a test's patience. What matters is the observable effect, not idleness.
	 */
	const waitFor = async (
		condition: () => Promise<boolean>,
		timeoutMs = 30_000
	): Promise<void> => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await condition()) return;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error("condition was never met");
	};

	const failedLogExists = async (): Promise<boolean> =>
		(await dataSource
			.getRepository(EmailLog)
			.count({ where: { userId, status: EmailLogStatus.FAILED } })) > 0;

	const makeAlert = async (
		frequency: AlertFrequency,
		name = "ทดสอบ"
	): Promise<JobAlert> =>
		dataSource.getRepository(JobAlert).save(
			dataSource.getRepository(JobAlert).create({
				userId,
				name,
				keywords: [],
				jobTypes: [],
				educations: [],
				provinces: [],
				notificationEmail: `owner${DOMAIN}`,
				frequency,
				isActive: true,
				matchFrom: new Date(Date.now() - 3_600_000),
			})
		);

	/** Records matches directly — the matching engine has its own suite. */
	const makeMatches = async (
		alert: JobAlert,
		count = 1,
		from = 0
	): Promise<JobAlertMatch[]> => {
		const repo = dataSource.getRepository(JobAlertMatch);
		return repo.save(
			jobIds
				.slice(from, from + count)
				.map((jobId) => repo.create({ jobAlertId: alert.id, jobId }))
		);
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
		await dataSource.getRepository(EmailLog).delete({ userId });
		await queue.obliterate({ force: true });
		provider.sent = [];
		provider.failWith = null;
	};

	beforeAll(async () => {
		provider = new StubProvider();
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(EMAIL_PROVIDER)
			.useValue(provider)
			.compile();

		app = moduleRef.createNestApplication();
		await app.init();
		dataSource = app.get(DataSource);
		dispatch = app.get(NotificationDispatchService);
		queue = app.get<Queue>(getQueueToken(QUEUE_EMAIL_NOTIFICATION));

		const user = await dataSource.getRepository(User).save(
			dataSource.getRepository(User).create({
				email: `owner${DOMAIN}`,
				passwordHash: "x",
				name: "เจ้าของ",
				role: UserRole.USER,
			})
		);
		userId = user.id;

		const jobs = await dataSource
			.getRepository(Job)
			.find({ take: 3, select: { id: true } });
		jobIds = jobs.map((job) => job.id);
		expect(jobIds).toHaveLength(3);

		await cleanUp();
	}, 90_000);

	afterEach(cleanUp);

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(User).delete({ email: Like(`%${DOMAIN}`) });
		}
		await app?.close();
	});

	describe("routing by frequency", () => {
		it("queues an immediate alert's match right away", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);

			expect(await dispatch.dispatchImmediate([match.id])).toBe(1);
			await drain();

			expect(provider.sent).toHaveLength(1);
			expect(provider.sent[0].to).toBe(`owner${DOMAIN}`);
		});

		it("leaves a digest alert's matches pending — that is the whole difference", async () => {
			const alert = await makeAlert(AlertFrequency.DAILY);
			const [match] = await makeMatches(alert);

			expect(await dispatch.dispatchImmediate([match.id])).toBe(0);
			await drain();

			expect(provider.sent).toEqual([]);
			const stored = await dataSource
				.getRepository(JobAlertMatch)
				.findOneByOrFail({ id: match.id });
			expect(stored.notifiedAt).toBeNull();
		});

		it("skips a paused alert", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			await dataSource.getRepository(JobAlert).update(alert.id, { isActive: false });
			const [match] = await makeMatches(alert);

			expect(await dispatch.dispatchImmediate([match.id])).toBe(0);
		});

		it("never re-queues a match that was already notified", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);
			await dataSource
				.getRepository(JobAlertMatch)
				.update(match.id, { notifiedAt: new Date() });

			expect(await dispatch.dispatchImmediate([match.id])).toBe(0);
		});
	});

	describe("digests", () => {
		it("collects every pending match for an alert into one email", async () => {
			const alert = await makeAlert(AlertFrequency.DAILY);
			await makeMatches(alert, 3);

			expect(await dispatch.dispatchDigests(AlertFrequency.DAILY)).toBe(1);
			await drain();

			// One message, not three.
			expect(provider.sent).toHaveLength(1);
			const pending = await dataSource
				.getRepository(JobAlertMatch)
				.count({ where: { jobAlertId: alert.id, notifiedAt: IsNull() } });
			expect(pending).toBe(0);
		});

		it("queues nothing for a frequency with no pending matches", async () => {
			await makeAlert(AlertFrequency.WEEKLY);
			expect(await dispatch.dispatchDigests(AlertFrequency.WEEKLY)).toBe(0);
		});

		it("does not send a second digest when the cron fires twice in one period", async () => {
			const alert = await makeAlert(AlertFrequency.DAILY);
			await makeMatches(alert, 2);

			const now = new Date("2026-09-22T03:00:00Z");
			await dispatch.dispatchDigests(AlertFrequency.DAILY, now);
			// Same Bangkok day, so the same period key — BullMQ drops the duplicate outright.
			await dispatch.dispatchDigests(AlertFrequency.DAILY, now);
			await drain();

			expect(provider.sent).toHaveLength(1);
		});

		it("does queue again in a different period", async () => {
			const alert = await makeAlert(AlertFrequency.DAILY);
			await makeMatches(alert, 1);

			await dispatch.dispatchDigests(
				AlertFrequency.DAILY,
				new Date("2026-09-22T03:00:00Z")
			);
			await drain();

			// New matches, next day: a different period key, so a second digest is correct.
			// From index 1: (alert, job) is unique, so a second batch has to use announcements
			// this alert does not already hold.
			await makeMatches(alert, 2, 1);
			await dispatch.dispatchDigests(
				AlertFrequency.DAILY,
				new Date("2026-09-23T03:00:00Z")
			);
			await drain();

			expect(provider.sent.length).toBeGreaterThanOrEqual(2);
		});

		it("does not mix one frequency's alerts into another's run", async () => {
			const daily = await makeAlert(AlertFrequency.DAILY, "รายวัน");
			await makeAlert(AlertFrequency.WEEKLY, "รายสัปดาห์");
			await makeMatches(daily, 1);

			expect(await dispatch.dispatchDigests(AlertFrequency.WEEKLY)).toBe(0);
			expect(await dispatch.dispatchDigests(AlertFrequency.DAILY)).toBe(1);
		});
	});

	describe("at-least-once delivery", () => {
		it("leaves matches unnotified and logs FAILED when the provider rejects", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);
			provider.failWith = new Error("mailbox unavailable");

			await dispatch.dispatchImmediate([match.id]);
			await waitFor(failedLogExists);

			// Never marked, so the next attempt still has something to send — losing the
			// notification is the failure this ordering exists to prevent.
			const stored = await dataSource
				.getRepository(JobAlertMatch)
				.findOneByOrFail({ id: match.id });
			expect(stored.notifiedAt).toBeNull();

			const logs = await dataSource
				.getRepository(EmailLog)
				.find({ where: { userId } });
			expect(logs.length).toBeGreaterThan(0);
			expect(logs.every((log) => log.status === EmailLogStatus.FAILED)).toBe(true);
			expect(logs[0].errorMessage).toContain("mailbox unavailable");
		}, 90_000);

		it("sends on a later attempt once the provider recovers", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);

			provider.failWith = new Error("temporary");
			await dispatch.dispatchImmediate([match.id]);
			await waitFor(failedLogExists);
			expect(provider.sent).toEqual([]);

			// A fresh dispatch is what a later crawl or digest run would do.
			provider.failWith = null;
			await queue.obliterate({ force: true });
			await dispatch.dispatchImmediate([match.id]);
			// Wait on the database write, not on the send: marking happens *after* the provider
			// returns, so asserting on `provider.sent` alone races the update.
			await waitFor(async () => {
				const row = await dataSource
					.getRepository(JobAlertMatch)
					.findOneByOrFail({ id: match.id });
				return row.notifiedAt !== null;
			});

			expect(provider.sent).toHaveLength(1);
		}, 120_000);

		it("sends nothing when a job is replayed after a successful send", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);

			await dispatch.dispatchImmediate([match.id]);
			await drain();
			expect(provider.sent).toHaveLength(1);

			// The processor re-reads the matches and stops when they are already notified, so an
			// ordinary retry after a successful send delivers nothing twice.
			await queue.obliterate({ force: true });
			await dispatch.dispatchImmediate([match.id]);
			await drain();

			expect(provider.sent).toHaveLength(1);
		}, 90_000);

		it("marks the alert's lastSentAt so the UI can show it", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);

			await dispatch.dispatchImmediate([match.id]);
			await drain();

			const stored = await dataSource
				.getRepository(JobAlert)
				.findOneByOrFail({ id: alert.id });
			expect(stored.lastSentAt).not.toBeNull();
		});
	});

	describe("the message itself", () => {
		it("carries the announcement and its source URL", async () => {
			const alert = await makeAlert(AlertFrequency.IMMEDIATE);
			const [match] = await makeMatches(alert);

			await dispatch.dispatchImmediate([match.id]);
			await drain();

			const job = await dataSource
				.getRepository(Job)
				.findOneByOrFail({ id: jobIds[0] });
			expect(provider.sent[0].subject).toContain(job.title);
			// Requirement 7: the original announcement is always reachable.
			expect(provider.sent[0].text).toContain(job.sourceUrl);
			expect(provider.sent[0].html).toContain(job.sourceUrl);
		});
	});
});

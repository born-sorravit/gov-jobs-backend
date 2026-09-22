import { EmailLogRepository } from "@/models/email/email-log.repository";
import { EmailService } from "@/modules/email/email.service";
import { EMAIL_PROVIDER } from "@/modules/email/interfaces/email-provider.interface";
import type { EmailProvider } from "@/modules/email/interfaces/email-provider.interface";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { Test } from "@nestjs/testing";

/**
 * `EmailLog` is the only record that a message was ever attempted, so both terminal states
 * have to be right. A provider stub is the only way to reach the failure branch —
 * `ConsoleEmailProvider` never fails.
 */
describe("EmailService", () => {
	let service: EmailService;
	let provider: EmailProvider & { send: jest.Mock };
	let saved: Record<string, unknown>;
	let updates: Record<string, unknown>[];

	const MESSAGE = {
		to: "someone@example.test",
		subject: "ประกาศใหม่",
		html: "<p>x</p>",
		text: "x",
		template: "job-alert-immediate",
	};

	beforeEach(async () => {
		saved = {};
		updates = [];
		provider = {
			name: "stub",
			send: jest.fn().mockResolvedValue({ providerMessageId: "provider-123" }),
		};

		const repository = {
			create: (input: Record<string, unknown>) => input,
			save: (input: Record<string, unknown>) => {
				saved = input;
				return Promise.resolve({ ...input, id: "log-1" });
			},
			update: (_id: string, patch: Record<string, unknown>) => {
				updates.push(patch);
				return Promise.resolve({ affected: 1 });
			},
		};

		const moduleRef = await Test.createTestingModule({
			providers: [
				EmailService,
				{ provide: EMAIL_PROVIDER, useValue: provider },
				{ provide: EmailLogRepository, useValue: repository },
			],
		}).compile();

		service = moduleRef.get(EmailService);
	});

	it("writes the log row before attempting the send", async () => {
		// A provider that hangs mid-send would otherwise leave no trace at all.
		provider.send.mockImplementation(() => {
			expect(saved.status).toBe(EmailLogStatus.QUEUED);
			return Promise.resolve({ providerMessageId: null });
		});

		await service.send(MESSAGE);

		expect(provider.send).toHaveBeenCalledTimes(1);
	});

	it("records which provider handled the message", async () => {
		await service.send(MESSAGE);
		// The only way to tell afterwards which vendor a message went through.
		expect(saved.provider).toBe("stub");
	});

	it("marks a successful send SENT, with the provider's id and a timestamp", async () => {
		await service.send(MESSAGE);

		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({
			status: EmailLogStatus.SENT,
			providerMessageId: "provider-123",
			sentAt: expect.any(Date),
		});
	});

	it("marks a failed send FAILED with the reason, and no sentAt", async () => {
		provider.send.mockRejectedValue(new Error("mailbox unavailable"));

		await expect(service.send(MESSAGE)).rejects.toThrow("mailbox unavailable");

		expect(updates[0]).toMatchObject({
			status: EmailLogStatus.FAILED,
			errorMessage: "mailbox unavailable",
		});
		expect(updates[0]).not.toHaveProperty("sentAt");
	});

	it("re-throws so the queue retries rather than swallowing the failure", async () => {
		provider.send.mockRejectedValue(new Error("boom"));
		await expect(service.send(MESSAGE)).rejects.toThrow("boom");
	});

	it("attaches the alert and user so the admin view can attribute a message", async () => {
		await service.send({ ...MESSAGE, jobAlertId: "alert-1", userId: "user-1" });
		expect(saved).toMatchObject({ jobAlertId: "alert-1", userId: "user-1" });
	});
});

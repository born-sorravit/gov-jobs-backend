import { EmailLogRepository } from "@/models/email/email-log.repository";
import { EMAIL_PROVIDER } from "@/modules/email/interfaces/email-provider.interface";
// Type-only: an interface in a decorated constructor parameter cannot be a value import.
import type {
	EmailMessage,
	EmailProvider,
} from "@/modules/email/interfaces/email-provider.interface";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { Inject, Injectable, Logger } from "@nestjs/common";

export interface SendEmailInput extends EmailMessage {
	/** Template key, e.g. `job-alert-immediate`. Not the rendered body. */
	template: string;
	jobAlertId?: string | null;
	userId?: string | null;
}

@Injectable()
export class EmailService {
	private readonly logger = new Logger(EmailService.name);

	constructor(
		@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
		private readonly emailLogRepository: EmailLogRepository
	) {}

	/**
	 * Sends one message and records it either way.
	 *
	 * The log row is written **before** the send, so a message that never comes back still
	 * leaves a trace — a provider that times out mid-send would otherwise be invisible.
	 * Failures re-throw so BullMQ retries; the row is what the admin view reads.
	 */
	async send(input: SendEmailInput): Promise<void> {
		const log = await this.emailLogRepository.save(
			this.emailLogRepository.create({
				toEmail: input.to,
				subject: input.subject,
				template: input.template,
				provider: this.provider.name,
				status: EmailLogStatus.QUEUED,
				jobAlertId: input.jobAlertId ?? null,
				userId: input.userId ?? null,
			})
		);

		try {
			const result = await this.provider.send(input);

			await this.emailLogRepository.update(log.id, {
				status: EmailLogStatus.SENT,
				providerMessageId: result.providerMessageId,
				sentAt: new Date(),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`Email to ${input.to} failed: ${message}`);

			await this.emailLogRepository.update(log.id, {
				status: EmailLogStatus.FAILED,
				errorMessage: message,
			});

			throw error;
		}
	}
}

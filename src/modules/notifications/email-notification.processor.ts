import { AppConfig, MailConfig } from "@/config/configuration";
import {
	EmailJobPayload,
	QUEUE_EMAIL_NOTIFICATION,
} from "@/constants/queue.constants";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { JobRepository } from "@/models/jobs/job.repository";
import { ReferenceItem } from "@/models/reference/entities/reference-item.entity";
import { ReferenceItemRepository } from "@/models/reference/reference-item.repository";
import { EmailService } from "@/modules/email/email.service";
import {
	EmailLocale,
	buildHtml,
	buildSubject,
	buildText,
} from "@/modules/email/templates/job-alert.template";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job as QueueJob } from "bullmq";
import { In } from "typeorm";

/**
 * Renders and sends one alert email, then marks its matches notified.
 *
 * **At-least-once.** Matches are loaded while still unnotified, sent, and only then marked —
 * so a crash between the send and the mark can duplicate one email. The alternative, marking
 * first, loses a notification outright when a send fails, and a missed job alert is the exact
 * failure this product exists to prevent. `JobAlertMatch`'s unique constraint still
 * guarantees one *row* per (alert, announcement); the narrowing is only in the send.
 */
@Processor(QUEUE_EMAIL_NOTIFICATION, { concurrency: 2 })
export class EmailNotificationProcessor extends WorkerHost {
	private readonly logger = new Logger(EmailNotificationProcessor.name);

	constructor(
		private readonly emailService: EmailService,
		private readonly jobAlertRepository: JobAlertRepository,
		private readonly jobAlertMatchRepository: JobAlertMatchRepository,
		private readonly jobRepository: JobRepository,
		private readonly referenceRepository: ReferenceItemRepository,
		private readonly configService: ConfigService
	) {
		super();
	}

	async process(queueJob: QueueJob<EmailJobPayload>): Promise<{ sent: number }> {
		const { kind, jobAlertId, matchIds } = queueJob.data;

		const alert = await this.jobAlertRepository.findOne({
			where: { id: jobAlertId },
			relations: { user: true },
		});

		// The alert was deleted or paused between queueing and delivery — nothing to send, and
		// nothing to retry.
		if (!alert || !alert.isActive) {
			return { sent: 0 };
		}

		// Re-read rather than trusting the payload: a retry after a successful send finds
		// these already notified and stops, which narrows the duplicate window.
		const matches = await this.jobAlertMatchRepository.find({
			where: { id: In(matchIds) },
		});
		const pending = matches.filter((match) => match.notifiedAt === null);
		if (pending.length === 0) {
			return { sent: 0 };
		}

		const jobs = await this.jobRepository.find({
			where: { id: In(pending.map((match) => match.jobId)) },
			order: { applicationEnd: "ASC" },
		});
		if (jobs.length === 0) {
			return { sent: 0 };
		}

		const app = this.configService.getOrThrow<AppConfig>("app");
		const mail = this.configService.getOrThrow<MailConfig>("mail");
		const locale: EmailLocale = alert.user?.locale === "en" ? "en" : "th";
		const webUrl = app.publicWebUrl.replace(/\/$/, "");

		// Points at the API, not the web app: the link has to keep working even if the
		// frontend is down or redeployed, because an unsubscribe that 404s is the complaint
		// this whole mechanism exists to prevent.
		// `apiPrefix` and the URI version are composed rather than hardcoded, so the link
		// follows the routing rather than quietly rotting if API_PREFIX ever changes.
		const unsubscribeUrl =
			`${app.publicApiUrl.replace(/\/$/, "")}/${app.apiPrefix}/v1/alerts/unsubscribe` +
			`?token=${encodeURIComponent(alert.unsubscribeToken)}`;

		const input = {
			locale,
			alertName: alert.name,
			jobs,
			labels: await this.loadLabels(),
			webUrl,
			manageUrl: `${webUrl}/alerts`,
			unsubscribeUrl,
		};

		await this.emailService.send({
			to: alert.notificationEmail,
			subject: buildSubject(input),
			html: buildHtml(input),
			text: buildText(input),
			template: `job-alert-${kind}`,
			jobAlertId: alert.id,
			userId: alert.userId,
			headers: this.unsubscribeHeaders(unsubscribeUrl, mail.replyTo),
		});

		const now = new Date();
		await this.jobAlertMatchRepository.update(
			{ id: In(pending.map((match) => match.id)) },
			{ notifiedAt: now }
		);
		await this.jobAlertRepository.update(alert.id, { lastSentAt: now });

		this.logger.log(
			`Sent ${kind} alert "${alert.name}" with ${jobs.length} announcement(s)`
		);
		return { sent: jobs.length };
	}

	/**
	 * What makes a mail client show its own "Unsubscribe" button next to the sender.
	 *
	 * Both headers are required: `List-Unsubscribe` alone is ignored by Gmail for one-click,
	 * and `List-Unsubscribe-Post` is what promises the URL can be POSTed to without the user
	 * having to visit a page (RFC 8058). A `mailto:` is offered alongside when a reply-to
	 * exists, for clients that prefer it.
	 */
	private unsubscribeHeaders(
		url: string,
		replyTo: string | undefined
	): Record<string, string> {
		const targets = replyTo
			? `<${url}>, <mailto:${replyTo}?subject=unsubscribe>`
			: `<${url}>`;

		return {
			"List-Unsubscribe": targets,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		};
	}

	/** Taxonomy labels keyed `${kind}:${externalId}`, so the template can resolve ids. */
	private async loadLabels(): Promise<Map<string, ReferenceItem>> {
		const items = await this.referenceRepository.find();
		return new Map(items.map((item) => [`${item.kind}:${item.externalId}`, item]));
	}
}

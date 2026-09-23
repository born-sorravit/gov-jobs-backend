import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";

export interface UnsubscribeResult {
	alertName: string;
	/** False when the alert was already off — the caller reports success either way. */
	changed: boolean;
}

/**
 * Switching an alert off from the link in its own email, with no account and no login.
 *
 * Separate from `JobAlertsService` because every method there is scoped to an owning user
 * id, which is exactly what this cannot require: the person who wants the mail to stop may
 * have no account at all.
 */
@Injectable()
export class UnsubscribeService {
	private readonly logger = new Logger(UnsubscribeService.name);

	constructor(private readonly jobAlertRepository: JobAlertRepository) {}

	/** The alert's name, for the confirmation page. Does not change anything. */
	async peek(token: string): Promise<{ alertName: string; isActive: boolean }> {
		const alert = await this.findByToken(token);
		return { alertName: alert.name, isActive: alert.isActive };
	}

	/**
	 * Pauses the alert. Deliberately not a delete: the owner keeps the saved search and its
	 * match history, and can resume it from the site.
	 *
	 * Idempotent — a second click, or a mail client retrying the one-click POST, reports the
	 * same success rather than an error about an alert that is already off.
	 */
	async unsubscribe(token: string): Promise<UnsubscribeResult> {
		const alert = await this.findByToken(token);

		if (!alert.isActive) {
			return { alertName: alert.name, changed: false };
		}

		await this.jobAlertRepository.update(alert.id, { isActive: false });
		this.logger.log(`Alert ${alert.id} switched off from an email link`);

		return { alertName: alert.name, changed: true };
	}

	/**
	 * 404 for a token that does not exist — never 400 or 401.
	 *
	 * The endpoint is public and unauthenticated, so a response that distinguished "malformed"
	 * from "no such token" would turn it into an oracle for probing which tokens are real.
	 */
	private async findByToken(token: string) {
		const alert =
			token.trim() === ""
				? null
				: await this.jobAlertRepository.findOne({
						where: { unsubscribeToken: token },
					});

		if (!alert) {
			throw new NotFoundException("This unsubscribe link is not valid");
		}

		return alert;
	}
}

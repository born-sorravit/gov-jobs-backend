import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import {
	EmailJobPayload,
	QUEUE_EMAIL_NOTIFICATION,
	digestEmailJobId,
	immediateEmailJobId,
} from "@/constants/queue.constants";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { getLocalDateString } from "@/shared/utils/date.util";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { In, IsNull } from "typeorm";

/** `2026-W39` — the ISO week an instant falls in, used as a weekly digest's period key. */
export const isoWeekKey = (date: Date): string => {
	const target = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
	// ISO weeks run Monday–Sunday and belong to the year containing their Thursday.
	const day = target.getUTCDay() || 7;
	target.setUTCDate(target.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
	const week = Math.ceil(
		((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
	);
	return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

@Injectable()
export class NotificationDispatchService {
	private readonly logger = new Logger(NotificationDispatchService.name);

	constructor(
		@InjectQueue(QUEUE_EMAIL_NOTIFICATION)
		private readonly emailQueue: Queue<EmailJobPayload>,
		private readonly jobAlertRepository: JobAlertRepository,
		private readonly jobAlertMatchRepository: JobAlertMatchRepository
	) {}

	/**
	 * Queues an email for matches on IMMEDIATE alerts.
	 *
	 * Digest alerts are deliberately skipped: their matches sit unnotified until the digest
	 * run collects them, which is the whole difference between the frequencies.
	 */
	async dispatchImmediate(matchIds: string[]): Promise<number> {
		if (matchIds.length === 0) return 0;

		const matches = await this.jobAlertMatchRepository.find({
			where: { id: In(matchIds), notifiedAt: IsNull() },
			relations: { jobAlert: true },
		});

		const immediate = matches.filter(
			(match) =>
				match.jobAlert?.isActive &&
				match.jobAlert.frequency === AlertFrequency.IMMEDIATE
		);
		if (immediate.length === 0) return 0;

		await this.emailQueue.addBulk(
			immediate.map((match) => ({
				name: "immediate",
				data: {
					kind: "immediate" as const,
					jobAlertId: match.jobAlertId,
					matchIds: [match.id],
				},
				opts: { jobId: immediateEmailJobId(match.id) },
			}))
		);

		return immediate.length;
	}

	/**
	 * Queues one digest per alert that has something pending.
	 *
	 * Driven from outside rather than by an in-process timer: the free-tier host sleeps, and
	 * a daily digest that only fires when somebody happens to visit the site is not a daily
	 * digest.
	 */
	async dispatchDigests(
		frequency: AlertFrequency,
		now = new Date()
	): Promise<number> {
		if (frequency === AlertFrequency.IMMEDIATE) return 0;

		const periodKey =
			frequency === AlertFrequency.DAILY ? getLocalDateString(now) : isoWeekKey(now);

		const pending = await this.jobAlertMatchRepository
			.createQueryBuilder("match")
			.select("match.job_alert_id", "alertId")
			.addSelect("array_agg(match.id::text)", "matchIds")
			.innerJoin("job_alert", "alert", "alert.id = match.job_alert_id")
			.where("match.notified_at IS NULL")
			.andWhere("alert.is_active = true")
			.andWhere("alert.frequency = :frequency", { frequency })
			.groupBy("match.job_alert_id")
			.getRawMany<{ alertId: string; matchIds: string[] }>();

		if (pending.length === 0) return 0;

		await this.emailQueue.addBulk(
			pending.map((row) => ({
				name: "digest",
				data: {
					kind: "digest" as const,
					jobAlertId: row.alertId,
					matchIds: row.matchIds,
				},
				opts: { jobId: digestEmailJobId(row.alertId, periodKey) },
			}))
		);

		this.logger.log(
			`Queued ${pending.length} ${frequency.toLowerCase()} digest(s) for ${periodKey}`
		);
		return pending.length;
	}

	/** Pending matches for one alert, for the digest body. */
	async pendingMatches(alertId: string): Promise<JobAlertMatch[]> {
		return this.jobAlertMatchRepository.find({
			where: { jobAlertId: alertId, notifiedAt: IsNull() },
			order: { matchedAt: "ASC" },
		});
	}

	async alertById(alertId: string) {
		return this.jobAlertRepository.findOne({
			where: { id: alertId },
			relations: { user: true },
		});
	}
}

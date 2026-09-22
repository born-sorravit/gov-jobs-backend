import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { CrawlerRunRepository } from "@/models/crawler/crawler-run.repository";
import { EmailLog } from "@/models/email/entities/email-log.entity";
import { EmailLogRepository } from "@/models/email/email-log.repository";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { JobRepository } from "@/models/jobs/job.repository";
import { SavedJobRepository } from "@/models/saved-jobs/saved-job.repository";
import { User } from "@/models/users/entities/user.entity";
import { UsersRepository } from "@/models/users/user.repository";
import {
	AdminAlertResponse,
	AdminEmailLogResponse,
	AdminOverviewResponse,
	AdminUserResponse,
	CrawlerRunResponse,
} from "@/modules/admin/dto/admin.response";
import { OrderDirection, PaginationDto } from "@/shared/dto/pagination.dto";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { UserRole } from "@/shared/enums/user-role.enum";
import { getLocalDateString } from "@/shared/utils/date.util";
import { jobStatusSqlExpression } from "@/shared/utils/job-status.util";
import { PaginatedResponse, paginate } from "@/shared/utils/pagination.util";
import { Injectable } from "@nestjs/common";
import { IsNull } from "typeorm";

@Injectable()
export class AdminService {
	constructor(
		private readonly usersRepository: UsersRepository,
		private readonly jobRepository: JobRepository,
		private readonly savedJobRepository: SavedJobRepository,
		private readonly jobAlertRepository: JobAlertRepository,
		private readonly jobAlertMatchRepository: JobAlertMatchRepository,
		private readonly emailLogRepository: EmailLogRepository,
		private readonly crawlerRunRepository: CrawlerRunRepository
	) {}

	/**
	 * Every headline number in one request.
	 *
	 * The counts run concurrently: a dozen sequential `COUNT(*)` at ~46ms each would make the
	 * dashboard visibly slow for no reason.
	 */
	async overview(): Promise<AdminOverviewResponse> {
		const today = getLocalDateString();

		const [
			users,
			admins,
			jobs,
			openJobs,
			savedJobs,
			alerts,
			activeAlerts,
			alertMatches,
			pendingNotifications,
			emailsSent,
			emailsFailed,
			recentRuns,
		] = await Promise.all([
			this.usersRepository.count(),
			this.usersRepository.count({ where: { role: UserRole.ADMIN } }),
			this.jobRepository.count(),
			this.jobRepository
				.createQueryBuilder("job")
				.where(`${jobStatusSqlExpression("job")} = 'OPEN'`, { today })
				.getCount(),
			this.savedJobRepository.count(),
			this.jobAlertRepository.count(),
			this.jobAlertRepository.count({ where: { isActive: true } }),
			this.jobAlertMatchRepository.count(),
			this.jobAlertMatchRepository.count({ where: { notifiedAt: IsNull() } }),
			this.emailLogRepository.count({ where: { status: EmailLogStatus.SENT } }),
			this.emailLogRepository.count({ where: { status: EmailLogStatus.FAILED } }),
			// Enough history to answer "is the crawler broken, or did it blip?"
			this.crawlerRunRepository.find({ order: { startedAt: "DESC" }, take: 20 }),
		]);

		return {
			users,
			admins,
			jobs,
			openJobs,
			savedJobs,
			alerts,
			activeAlerts,
			alertMatches,
			pendingNotifications,
			emailsSent,
			emailsFailed,
			lastCrawlerRun: recentRuns[0] ? this.toCrawlerRun(recentRuns[0]) : null,
			consecutiveFailures: this.countLeadingFailures(recentRuns),
		};
	}

	async crawlerRuns(
		query: PaginationDto
	): Promise<PaginatedResponse<CrawlerRunResponse>> {
		const qb = this.crawlerRunRepository.createQueryBuilder("crawler_run");
		const page = await paginate(
			qb,
			query,
			{ startedAt: "crawler_run.started_at", status: "crawler_run.status" },
			{ expression: "crawler_run.started_at", order: OrderDirection.DESC }
		);
		return page.map((run) => this.toCrawlerRun(run));
	}

	async users(query: PaginationDto): Promise<PaginatedResponse<AdminUserResponse>> {
		const qb = this.usersRepository.createQueryBuilder("user");
		const page = await paginate(
			qb,
			query,
			{ createdAt: "user.created_at", email: "user.email", role: "user.role" },
			{ expression: "user.created_at", order: OrderDirection.DESC }
		);

		const ids = page.data.map((user) => user.id);
		const [alertCounts, savedCounts] = await Promise.all([
			this.alertCounts(ids),
			this.savedJobCounts(ids),
		]);

		return page.map((user) => this.toUser(user, alertCounts, savedCounts));
	}

	async alerts(
		query: PaginationDto
	): Promise<PaginatedResponse<AdminAlertResponse>> {
		const qb = this.jobAlertRepository
			.createQueryBuilder("alert")
			.innerJoinAndSelect("alert.user", "user");

		const page = await paginate(
			qb,
			query,
			{
				createdAt: "alert.created_at",
				name: "alert.name",
				lastSentAt: "alert.last_sent_at",
			},
			{ expression: "alert.created_at", order: OrderDirection.DESC }
		);

		const counts = await this.matchCounts(page.data.map((alert) => alert.id));
		return page.map((alert) => this.toAlert(alert, counts.get(alert.id) ?? 0));
	}

	async emailLogs(
		query: PaginationDto
	): Promise<PaginatedResponse<AdminEmailLogResponse>> {
		const qb = this.emailLogRepository.createQueryBuilder("email_log");
		const page = await paginate(
			qb,
			query,
			{ createdAt: "email_log.created_at", status: "email_log.status" },
			{ expression: "email_log.created_at", order: OrderDirection.DESC }
		);
		return page.map((log) => this.toEmailLog(log));
	}

	/**
	 * How many runs have failed in a row since the last success.
	 *
	 * One failure is a blip — the source is a public portal that occasionally 500s. Several
	 * in a row is the thing worth surfacing.
	 */
	private countLeadingFailures(runs: CrawlerRun[]): number {
		let count = 0;
		for (const run of runs) {
			if (run.status === CrawlerRunStatus.SUCCESS) break;
			if (run.status === CrawlerRunStatus.FAILED) count += 1;
		}
		return count;
	}

	/** Alerts per user, for the listed page only. */
	private async alertCounts(userIds: string[]): Promise<Map<string, number>> {
		if (userIds.length === 0) return new Map();

		const rows = await this.jobAlertRepository
			.createQueryBuilder("alert")
			.select("alert.user_id", "id")
			.addSelect("COUNT(*)::int", "count")
			.where("alert.user_id = ANY(:userIds)", { userIds })
			.groupBy("alert.user_id")
			.getRawMany<{ id: string; count: number }>();

		return new Map(rows.map((row) => [row.id, row.count]));
	}

	/** Saved announcements per user, for the listed page only. */
	private async savedJobCounts(userIds: string[]): Promise<Map<string, number>> {
		if (userIds.length === 0) return new Map();

		const rows = await this.savedJobRepository
			.createQueryBuilder("saved_job")
			.select("saved_job.user_id", "id")
			.addSelect("COUNT(*)::int", "count")
			.where("saved_job.user_id = ANY(:userIds)", { userIds })
			.groupBy("saved_job.user_id")
			.getRawMany<{ id: string; count: number }>();

		return new Map(rows.map((row) => [row.id, row.count]));
	}

	private async matchCounts(alertIds: string[]): Promise<Map<string, number>> {
		if (alertIds.length === 0) return new Map();

		const rows = await this.jobAlertMatchRepository
			.createQueryBuilder("match")
			.select("match.job_alert_id", "id")
			.addSelect("COUNT(*)::int", "count")
			.where("match.job_alert_id = ANY(:alertIds)", { alertIds })
			.groupBy("match.job_alert_id")
			.getRawMany<{ id: string; count: number }>();

		return new Map(rows.map((row) => [row.id, row.count]));
	}

	private toCrawlerRun(run: CrawlerRun): CrawlerRunResponse {
		return {
			id: run.id,
			source: run.source,
			status: run.status,
			trigger: run.trigger,
			startedAt: run.startedAt.toISOString(),
			finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
			durationSeconds: run.finishedAt
				? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
				: null,
			totalFound: run.totalFound,
			newJobs: run.newJobs,
			updatedJobs: run.updatedJobs,
			unchangedJobs: run.unchangedJobs,
			skippedJobs: run.skippedJobs,
			alertMatches: run.alertMatches,
			errorMessage: run.errorMessage,
		};
	}

	private toUser(
		user: User,
		alertCounts: Map<string, number>,
		savedCounts: Map<string, number>
	): AdminUserResponse {
		return {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			isVerified: user.isVerified,
			createdAt: user.createdAt.toISOString(),
			alertCount: alertCounts.get(user.id) ?? 0,
			savedJobCount: savedCounts.get(user.id) ?? 0,
		};
	}

	private toAlert(alert: JobAlert, matchCount: number): AdminAlertResponse {
		return {
			id: alert.id,
			name: alert.name,
			ownerEmail: alert.user?.email ?? alert.notificationEmail,
			frequency: alert.frequency,
			isActive: alert.isActive,
			keywordCount: alert.keywords?.length ?? 0,
			matchCount,
			lastSentAt: alert.lastSentAt ? alert.lastSentAt.toISOString() : null,
			createdAt: alert.createdAt.toISOString(),
		};
	}

	private toEmailLog(log: EmailLog): AdminEmailLogResponse {
		return {
			id: log.id,
			toEmail: log.toEmail,
			subject: log.subject,
			template: log.template,
			status: log.status,
			provider: log.provider,
			sentAt: log.sentAt ? log.sentAt.toISOString() : null,
			errorMessage: log.errorMessage,
			createdAt: log.createdAt.toISOString(),
		};
	}
}

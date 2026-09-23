import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { UsersRepository } from "@/models/users/user.repository";
import {
	CreateJobAlertDto,
	JobAlertResponse,
	QueryJobAlertsDto,
	UpdateJobAlertDto,
} from "@/modules/job-alerts/dto/job-alert.dto";
import { OrderDirection } from "@/shared/dto/pagination.dto";
import { PaginatedResponse, paginate } from "@/shared/utils/pagination.util";
import {
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from "@nestjs/common";
import { In } from "typeorm";

const SORTABLE = {
	createdAt: "alert.created_at",
	name: "alert.name",
	lastSentAt: "alert.last_sent_at",
};

@Injectable()
export class JobAlertsService {
	constructor(
		private readonly jobAlertRepository: JobAlertRepository,
		private readonly jobAlertMatchRepository: JobAlertMatchRepository,
		private readonly usersRepository: UsersRepository
	) {}

	async findAll(
		userId: string,
		query: QueryJobAlertsDto
	): Promise<PaginatedResponse<JobAlertResponse>> {
		const qb = this.jobAlertRepository
			.createQueryBuilder("alert")
			.where("alert.user_id = :userId", { userId });

		const page = await paginate(qb, query, SORTABLE, {
			expression: "alert.created_at",
			order: OrderDirection.DESC,
		});

		const counts = await this.countMatches(page.data.map((alert) => alert.id));

		return page.map((alert) => this.toResponse(alert, counts.get(alert.id) ?? 0));
	}

	async findOne(userId: string, id: string): Promise<JobAlertResponse> {
		const alert = await this.getOwned(userId, id);
		const counts = await this.countMatches([alert.id]);
		return this.toResponse(alert, counts.get(alert.id) ?? 0);
	}

	async create(userId: string, dto: CreateJobAlertDto): Promise<JobAlertResponse> {
		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new UnauthorizedException("Account no longer exists");
		}

		const alert = this.jobAlertRepository.create({
			userId,
			name: dto.name,
			keywords: dto.keywords ?? [],
			jobTypes: dto.jobTypes ?? [],
			educations: dto.educations ?? [],
			provinces: dto.provinces ?? [],
			// The owner's address, always — see the note on `CreateJobAlertDto`. A client that
			// could name the recipient could mail a stranger who has no way to stop it.
			notificationEmail: user.email,
			// `unsubscribeToken` is filled by the entity's @BeforeInsert, so every alert has one
			// however it was created.
			frequency: dto.frequency,
			isActive: true,
			// The floor: only announcements discovered from now on can ever match.
			matchFrom: new Date(),
		});

		await this.jobAlertRepository.save(alert);
		return this.toResponse(alert, 0);
	}

	/**
	 * `matchFrom` is deliberately untouched here.
	 *
	 * Matching runs over the announcements a crawl just changed, not over the archive, so
	 * broadened criteria take effect for everything discovered from now on either way —
	 * and leaving the floor alone means an edit can never be used to replay old matches.
	 */
	async update(
		userId: string,
		id: string,
		dto: UpdateJobAlertDto
	): Promise<JobAlertResponse> {
		const alert = await this.getOwned(userId, id);

		Object.assign(alert, {
			name: dto.name ?? alert.name,
			keywords: dto.keywords ?? alert.keywords,
			jobTypes: dto.jobTypes ?? alert.jobTypes,
			educations: dto.educations ?? alert.educations,
			provinces: dto.provinces ?? alert.provinces,
			frequency: dto.frequency ?? alert.frequency,
			isActive: dto.isActive ?? alert.isActive,
		});

		await this.jobAlertRepository.save(alert);
		const counts = await this.countMatches([alert.id]);
		return this.toResponse(alert, counts.get(alert.id) ?? 0);
	}

	async remove(userId: string, id: string): Promise<void> {
		const alert = await this.getOwned(userId, id);
		// Hard delete: matches cascade, and there is no history worth keeping for a saved
		// search the user asked to be rid of.
		await this.jobAlertRepository.delete(alert.id);
	}

	async pause(userId: string, id: string): Promise<JobAlertResponse> {
		const alert = await this.getOwned(userId, id);
		alert.isActive = false;
		await this.jobAlertRepository.save(alert);
		const counts = await this.countMatches([alert.id]);
		return this.toResponse(alert, counts.get(alert.id) ?? 0);
	}

	/**
	 * Resuming advances the floor to now.
	 *
	 * The matcher already skips inactive alerts, so nothing accumulates during a pause — but
	 * moving `matchFrom` makes "a paused alert never notifies about what it missed" true in
	 * the data itself, rather than as a side effect of how matching happens to be scheduled.
	 */
	async resume(userId: string, id: string): Promise<JobAlertResponse> {
		const alert = await this.getOwned(userId, id);
		alert.isActive = true;
		alert.matchFrom = new Date();
		await this.jobAlertRepository.save(alert);
		const counts = await this.countMatches([alert.id]);
		return this.toResponse(alert, counts.get(alert.id) ?? 0);
	}

	/**
	 * Fetches by id **and** owner, so another user's alert is a 404 rather than a 403 — an
	 * id that is not yours should not be confirmable as existing.
	 */
	private async getOwned(userId: string, id: string): Promise<JobAlert> {
		const alert = await this.jobAlertRepository.findOne({ where: { id, userId } });
		if (!alert) {
			throw new NotFoundException("Job alert not found");
		}
		return alert;
	}

	private async countMatches(alertIds: string[]): Promise<Map<string, number>> {
		if (alertIds.length === 0) return new Map();

		const rows = await this.jobAlertMatchRepository
			.createQueryBuilder("match")
			.select("match.job_alert_id", "alertId")
			.addSelect("COUNT(*)::int", "count")
			.where({ jobAlertId: In(alertIds) })
			.groupBy("match.job_alert_id")
			.getRawMany<{ alertId: string; count: number }>();

		return new Map(rows.map((row) => [row.alertId, row.count]));
	}

	private toResponse(alert: JobAlert, matchCount: number): JobAlertResponse {
		return {
			id: alert.id,
			name: alert.name,
			keywords: alert.keywords ?? [],
			jobTypes: alert.jobTypes ?? [],
			educations: alert.educations ?? [],
			provinces: alert.provinces ?? [],
			notificationEmail: alert.notificationEmail,
			frequency: alert.frequency,
			isActive: alert.isActive,
			matchFrom: alert.matchFrom.toISOString(),
			lastSentAt: alert.lastSentAt ? alert.lastSentAt.toISOString() : null,
			createdAt: alert.createdAt.toISOString(),
			matchCount,
		};
	}
}

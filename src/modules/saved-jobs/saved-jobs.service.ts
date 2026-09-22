import { JobRepository } from "@/models/jobs/job.repository";
import { SavedJob } from "@/models/saved-jobs/entities/saved-job.entity";
import { SavedJobRepository } from "@/models/saved-jobs/saved-job.repository";
import { toJobSummary } from "@/modules/jobs/dto/job.response";
import { SavedJobResponse } from "@/modules/saved-jobs/dto/saved-job.response";
import { OrderDirection, PaginationDto } from "@/shared/dto/pagination.dto";
import { getLocalDateString } from "@/shared/utils/date.util";
import { PaginatedResponse, paginate } from "@/shared/utils/pagination.util";
import { Injectable, NotFoundException } from "@nestjs/common";

/** API sort keys for the saved list. `savedAt` is the column the user actually thinks in. */
const SORTABLE = {
	savedAt: "saved_job.created_at",
	applicationEnd: "job.application_end",
	publishedAt: "job.published_at",
	title: "job.title",
};

@Injectable()
export class SavedJobsService {
	constructor(
		private readonly savedJobRepository: SavedJobRepository,
		private readonly jobRepository: JobRepository
	) {}

	async findAll(
		userId: string,
		query: PaginationDto
	): Promise<PaginatedResponse<SavedJobResponse>> {
		const today = getLocalDateString();

		const qb = this.savedJobRepository
			.createQueryBuilder("saved_job")
			.innerJoinAndSelect("saved_job.job", "job")
			.where("saved_job.user_id = :userId", { userId });

		const page = await paginate(qb, query, SORTABLE, {
			expression: "saved_job.created_at",
			order: OrderDirection.DESC,
		});

		return page.map((saved) => ({
			...toJobSummary(saved.job, today),
			savedAt: saved.createdAt.toISOString(),
		}));
	}

	/** Just the ids, so a job list can mark its cards without the API knowing who is asking. */
	async findIds(userId: string): Promise<string[]> {
		const rows = await this.savedJobRepository.find({
			where: { userId },
			select: { jobId: true },
		});

		return rows.map((row) => row.jobId);
	}

	/**
	 * Idempotent: saving something already saved is a success, not a conflict — the user's
	 * intent is satisfied either way, and a 409 would make an optimistic toggle flicker back.
	 */
	async save(userId: string, jobId: string): Promise<void> {
		const exists = await this.jobRepository.exists({ where: { id: jobId } });
		if (!exists) {
			throw new NotFoundException("Job announcement not found");
		}

		await this.savedJobRepository
			.createQueryBuilder()
			.insert()
			.into(SavedJob)
			.values({ userId, jobId })
			// Let the unique index absorb the race rather than checking first.
			.orIgnore()
			.execute();
	}

	/**
	 * Also idempotent, and a **hard** delete on purpose.
	 *
	 * `SavedJob` inherits `deletedAt`, but `uq_saved_job_user_job` has no
	 * `WHERE deleted_at IS NULL`, so a soft delete would leave the row in place and every
	 * later attempt to re-save that job would fail on the unique index, permanently.
	 */
	async remove(userId: string, jobId: string): Promise<void> {
		await this.savedJobRepository.delete({ userId, jobId });
	}
}

import { Job } from "@/models/jobs/entities/job.entity";
import { JobRepository } from "@/models/jobs/job.repository";
import {
	JOB_SORTABLE_COLUMNS,
	QueryJobsDto,
} from "@/modules/jobs/dto/query-jobs.dto";
import {
	JobDetailResponse,
	JobSummaryResponse,
	toJobDetail,
	toJobSummary,
} from "@/modules/jobs/dto/job.response";
import { OrderDirection } from "@/shared/dto/pagination.dto";
import { getLocalDateString } from "@/shared/utils/date.util";
import { jobStatusSqlExpression } from "@/shared/utils/job-status.util";
import { PaginatedResponse, paginate } from "@/shared/utils/pagination.util";
import { Injectable, NotFoundException } from "@nestjs/common";
import { SelectQueryBuilder } from "typeorm";

@Injectable()
export class JobsService {
	constructor(private readonly jobRepository: JobRepository) {}

	async findAll(
		query: QueryJobsDto
	): Promise<PaginatedResponse<JobSummaryResponse>> {
		// One "today" for the whole request: the filter and every row's rendered status must
		// agree even if the request straddles midnight in Bangkok.
		const today = getLocalDateString();

		const qb = this.jobRepository.createQueryBuilder("job");
		this.applyFilters(qb, query, today);

		const page = await paginate(qb, query, JOB_SORTABLE_COLUMNS, {
			expression: "job.published_at",
			order: OrderDirection.DESC,
		});

		return page.map((job) => toJobSummary(job, today));
	}

	async findOne(id: string): Promise<JobDetailResponse> {
		const job = await this.jobRepository.findOne({
			where: { id },
			relations: { attachments: true },
		});

		if (!job) {
			throw new NotFoundException("Job announcement not found");
		}

		return toJobDetail(job);
	}

	private applyFilters(
		qb: SelectQueryBuilder<Job>,
		query: QueryJobsDto,
		today: string
	): void {
		if (query.q) {
			// Thai has no word boundaries, so substring matching is the only thing that works;
			// the trigram GIN indexes on these three columns are what make it affordable.
			qb.andWhere(
				"(job.title ILIKE :q OR job.agency ILIKE :q OR job.ministry ILIKE :q)",
				{ q: `%${query.q}%` }
			);
		}

		if (query.jobType?.length) {
			qb.andWhere("job.job_type_id = ANY(:jobType)", { jobType: query.jobType });
		}

		if (query.jobCategory?.length) {
			qb.andWhere("job.job_category_id = ANY(:jobCategory)", {
				jobCategory: query.jobCategory,
			});
		}

		if (query.education?.length) {
			qb.andWhere("job.education_level_ids && :education::int[]", {
				education: query.education,
			});
		}

		if (query.province?.length) {
			// An announcement with no province listed is nationwide, not unknown, so it belongs
			// in every province's results — unless the caller explicitly opts out.
			qb.andWhere(
				query.provinceStrict
					? "job.province_ids && :province::int[]"
					: "(job.province_ids && :province::int[] OR cardinality(job.province_ids) = 0)",
				{ province: query.province }
			);
		}

		if (query.status) {
			qb.andWhere(`${jobStatusSqlExpression("job")} = :status`, {
				status: query.status,
				today,
			});
		}

		// Salary is a range-overlap test, and both bounds are nullable. Without the explicit
		// IS NULL arms a row with an unpublished salary would compare to NULL and silently
		// disappear — we show it instead, the same way an unlisted province is shown.
		if (query.salaryMin !== undefined) {
			qb.andWhere("(job.salary_max IS NULL OR job.salary_max >= :salaryMin)", {
				salaryMin: query.salaryMin,
			});
		}

		if (query.salaryMax !== undefined) {
			qb.andWhere("(job.salary_min IS NULL OR job.salary_min <= :salaryMax)", {
				salaryMax: query.salaryMax,
			});
		}
	}
}

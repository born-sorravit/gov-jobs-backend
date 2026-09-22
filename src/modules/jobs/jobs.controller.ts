import { Public } from "@/shared/decorators/public.decorator";
import {
	JobDetailResponse,
	JobSummaryResponse,
} from "@/modules/jobs/dto/job.response";
import { QueryJobsDto } from "@/modules/jobs/dto/query-jobs.dto";
import { JobsService } from "@/modules/jobs/jobs.service";
import { PaginatedResponse } from "@/shared/utils/pagination.util";
import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

// A public job board: browsing and reading announcements never requires an account.
@Public()
@ApiTags("jobs")
@Controller("jobs")
export class JobsController {
	constructor(private readonly jobsService: JobsService) {}

	@Get()
	@ApiOperation({
		summary: "Search government job announcements",
		description:
			"Keyword, taxonomy, status and salary filters with pagination. Status is computed " +
			"server-side against Asia/Bangkok so every caller agrees on what is open today.",
	})
	@ApiOkResponse({ type: [JobSummaryResponse] })
	findAll(
		@Query() query: QueryJobsDto
	): Promise<PaginatedResponse<JobSummaryResponse>> {
		return this.jobsService.findAll(query);
	}

	@Get(":id")
	@ApiOperation({
		summary: "One announcement, with its attachments and source links",
	})
	@ApiOkResponse({ type: JobDetailResponse })
	findOne(@Param("id", ParseUUIDPipe) id: string): Promise<JobDetailResponse> {
		return this.jobsService.findOne(id);
	}
}

import { SavedJobResponse } from "@/modules/saved-jobs/dto/saved-job.response";
import { SavedJobsService } from "@/modules/saved-jobs/saved-jobs.service";
import { PaginationDto } from "@/shared/dto/pagination.dto";
import { CurrentUser } from "@/shared/decorators/current-user.decorator";
import type { AuthenticatedUser } from "@/shared/decorators/current-user.decorator";
import { PaginatedResponse } from "@/shared/utils/pagination.util";
import {
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Post,
	Query,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";

@ApiTags("saved-jobs")
@ApiBearerAuth()
@Controller("saved-jobs")
export class SavedJobsController {
	constructor(private readonly savedJobsService: SavedJobsService) {}

	@Get()
	@ApiOperation({
		summary: "The signed-in user's saved announcements, newest first",
	})
	@ApiOkResponse({ type: [SavedJobResponse] })
	findAll(
		@CurrentUser() user: AuthenticatedUser,
		@Query() query: PaginationDto
	): Promise<PaginatedResponse<SavedJobResponse>> {
		return this.savedJobsService.findAll(user.id, query);
	}

	/**
	 * Declared before any `:jobId` route: Nest matches in declaration order and `ids` is a
	 * perfectly valid string for a param, so the reverse order would 400 on every call.
	 */
	@Get("ids")
	@ApiOperation({
		summary: "Ids of the user's saved announcements",
		description:
			"Lets a public, cacheable job list mark its cards client-side, instead of making " +
			"GET /jobs vary per user.",
	})
	findIds(@CurrentUser() user: AuthenticatedUser): Promise<string[]> {
		return this.savedJobsService.findIds(user.id);
	}

	@Post(":jobId")
	@HttpCode(200)
	@ApiOperation({ summary: "Save an announcement", description: "Idempotent." })
	async save(
		@CurrentUser() user: AuthenticatedUser,
		@Param("jobId", ParseUUIDPipe) jobId: string
	): Promise<{ saved: boolean; jobId: string }> {
		await this.savedJobsService.save(user.id, jobId);
		return { saved: true, jobId };
	}

	@Delete(":jobId")
	@HttpCode(200)
	@ApiOperation({
		summary: "Remove a saved announcement",
		description:
			"Idempotent — removing one that was never saved is still a success.",
	})
	async remove(
		@CurrentUser() user: AuthenticatedUser,
		@Param("jobId", ParseUUIDPipe) jobId: string
	): Promise<{ saved: boolean; jobId: string }> {
		await this.savedJobsService.remove(user.id, jobId);
		return { saved: false, jobId };
	}
}

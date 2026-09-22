import {
	CreateJobAlertDto,
	JobAlertResponse,
	QueryJobAlertsDto,
	UpdateJobAlertDto,
} from "@/modules/job-alerts/dto/job-alert.dto";
import { JobAlertsService } from "@/modules/job-alerts/job-alerts.service";
import { CurrentUser } from "@/shared/decorators/current-user.decorator";
import type { AuthenticatedUser } from "@/shared/decorators/current-user.decorator";
import { MessagedResponse } from "@/shared/interceptors/response.interceptor";
import { PaginatedResponse } from "@/shared/utils/pagination.util";
import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";

@ApiTags("job-alerts")
@ApiBearerAuth()
@Controller("job-alerts")
export class JobAlertsController {
	constructor(private readonly jobAlertsService: JobAlertsService) {}

	@Get()
	@ApiOperation({ summary: "The signed-in user's alerts" })
	@ApiOkResponse({ type: [JobAlertResponse] })
	findAll(
		@CurrentUser() user: AuthenticatedUser,
		@Query() query: QueryJobAlertsDto
	): Promise<PaginatedResponse<JobAlertResponse>> {
		return this.jobAlertsService.findAll(user.id, query);
	}

	@Post()
	@ApiOperation({
		summary: "Create an alert",
		description:
			"Matching starts now: announcements discovered before this moment never match, so " +
			"creating an alert cannot deliver the whole back catalogue.",
	})
	@ApiOkResponse({ type: JobAlertResponse })
	create(
		@CurrentUser() user: AuthenticatedUser,
		@Body() dto: CreateJobAlertDto
	): Promise<JobAlertResponse> {
		return this.jobAlertsService.create(user.id, dto);
	}

	@Get(":id")
	@ApiOperation({ summary: "One alert" })
	@ApiOkResponse({ type: JobAlertResponse })
	findOne(
		@CurrentUser() user: AuthenticatedUser,
		@Param("id", ParseUUIDPipe) id: string
	): Promise<JobAlertResponse> {
		return this.jobAlertsService.findOne(user.id, id);
	}

	@Patch(":id")
	@ApiOperation({
		summary: "Edit an alert",
		description:
			"Does not move the matching floor; new criteria apply to future discoveries.",
	})
	@ApiOkResponse({ type: JobAlertResponse })
	update(
		@CurrentUser() user: AuthenticatedUser,
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateJobAlertDto
	): Promise<JobAlertResponse> {
		return this.jobAlertsService.update(user.id, id, dto);
	}

	@Delete(":id")
	@ApiOperation({ summary: "Delete an alert and its recorded matches" })
	async remove(
		@CurrentUser() user: AuthenticatedUser,
		@Param("id", ParseUUIDPipe) id: string
	): Promise<MessagedResponse<null>> {
		await this.jobAlertsService.remove(user.id, id);
		return new MessagedResponse(null, "Alert deleted");
	}

	@Post(":id/pause")
	@HttpCode(200)
	@ApiOperation({ summary: "Stop matching without deleting the alert" })
	@ApiOkResponse({ type: JobAlertResponse })
	pause(
		@CurrentUser() user: AuthenticatedUser,
		@Param("id", ParseUUIDPipe) id: string
	): Promise<JobAlertResponse> {
		return this.jobAlertsService.pause(user.id, id);
	}

	@Post(":id/resume")
	@HttpCode(200)
	@ApiOperation({
		summary: "Resume matching",
		description:
			"Moves the matching floor to now, so a resumed alert never reports what it missed " +
			"while paused.",
	})
	@ApiOkResponse({ type: JobAlertResponse })
	resume(
		@CurrentUser() user: AuthenticatedUser,
		@Param("id", ParseUUIDPipe) id: string
	): Promise<JobAlertResponse> {
		return this.jobAlertsService.resume(user.id, id);
	}
}

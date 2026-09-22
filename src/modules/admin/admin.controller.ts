import { AdminService } from "@/modules/admin/admin.service";
import {
	AdminAlertResponse,
	AdminEmailLogResponse,
	AdminOverviewResponse,
	AdminUserResponse,
	CrawlerRunResponse,
} from "@/modules/admin/dto/admin.response";
import { PaginationDto } from "@/shared/dto/pagination.dto";
import { Roles } from "@/shared/decorators/roles.decorator";
import { UserRole } from "@/shared/enums/user-role.enum";
import { PaginatedResponse } from "@/shared/utils/pagination.util";
import { Controller, Get, Query } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";

/**
 * Read-only throughout.
 *
 * The spec asks for visibility, not controls, and every action that might belong here —
 * re-running a crawl, resending an email — already exists as an internal endpoint driven by
 * the scheduler. Roles are re-read from the database by `RolesGuard`, so a demotion takes
 * effect immediately rather than when the token expires.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller("admin")
export class AdminController {
	constructor(private readonly adminService: AdminService) {}

	@Get("overview")
	@ApiOperation({ summary: "Headline counts and crawler health" })
	@ApiOkResponse({ type: AdminOverviewResponse })
	overview(): Promise<AdminOverviewResponse> {
		return this.adminService.overview();
	}

	@Get("crawler-runs")
	@ApiOperation({ summary: "Crawl history, newest first" })
	@ApiOkResponse({ type: [CrawlerRunResponse] })
	crawlerRuns(
		@Query() query: PaginationDto
	): Promise<PaginatedResponse<CrawlerRunResponse>> {
		return this.adminService.crawlerRuns(query);
	}

	@Get("users")
	@ApiOperation({ summary: "Accounts" })
	@ApiOkResponse({ type: [AdminUserResponse] })
	users(
		@Query() query: PaginationDto
	): Promise<PaginatedResponse<AdminUserResponse>> {
		return this.adminService.users(query);
	}

	@Get("alerts")
	@ApiOperation({ summary: "Every alert, with its owner" })
	@ApiOkResponse({ type: [AdminAlertResponse] })
	alerts(
		@Query() query: PaginationDto
	): Promise<PaginatedResponse<AdminAlertResponse>> {
		return this.adminService.alerts(query);
	}

	@Get("email-logs")
	@ApiOperation({ summary: "Outbound email, newest first" })
	@ApiOkResponse({ type: [AdminEmailLogResponse] })
	emailLogs(
		@Query() query: PaginationDto
	): Promise<PaginatedResponse<AdminEmailLogResponse>> {
		return this.adminService.emailLogs(query);
	}
}

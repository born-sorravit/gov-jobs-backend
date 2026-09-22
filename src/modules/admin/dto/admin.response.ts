import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CrawlerRunResponse {
	@ApiProperty() id: string;
	@ApiProperty() source: string;
	@ApiProperty({ enum: CrawlerRunStatus }) status: CrawlerRunStatus;
	@ApiProperty() trigger: string;
	@ApiProperty() startedAt: string;
	@ApiPropertyOptional() finishedAt: string | null;
	@ApiPropertyOptional({ description: "Seconds, or null while still running." })
	durationSeconds: number | null;
	@ApiProperty() totalFound: number;
	@ApiProperty() newJobs: number;
	@ApiProperty() updatedJobs: number;
	@ApiProperty() unchangedJobs: number;
	@ApiProperty() skippedJobs: number;
	@ApiProperty() alertMatches: number;
	@ApiPropertyOptional() errorMessage: string | null;
}

export class AdminOverviewResponse {
	@ApiProperty() users: number;
	@ApiProperty() admins: number;
	@ApiProperty() jobs: number;
	@ApiProperty({ description: "Accepting applications today, in Asia/Bangkok." })
	openJobs: number;
	@ApiProperty() savedJobs: number;
	@ApiProperty() alerts: number;
	@ApiProperty() activeAlerts: number;
	@ApiProperty() alertMatches: number;
	@ApiProperty({ description: "Matched but not yet emailed." })
	pendingNotifications: number;
	@ApiProperty() emailsSent: number;
	@ApiProperty() emailsFailed: number;
	@ApiPropertyOptional({ type: CrawlerRunResponse })
	lastCrawlerRun: CrawlerRunResponse | null;
	@ApiProperty({ description: "Consecutive failed runs since the last success." })
	consecutiveFailures: number;
}

/**
 * Explicitly listed rather than the entity spread.
 *
 * This is a page that shows personal data by necessity; what it shows should be a decision,
 * not whatever happens to be on the row. `passwordHash` is `select: false` anyway.
 */
export class AdminUserResponse {
	@ApiProperty() id: string;
	@ApiProperty() email: string;
	@ApiProperty() name: string;
	@ApiProperty() role: string;
	@ApiProperty() isVerified: boolean;
	@ApiProperty() createdAt: string;
	@ApiProperty() alertCount: number;
	@ApiProperty() savedJobCount: number;
}

export class AdminEmailLogResponse {
	@ApiProperty() id: string;
	@ApiProperty() toEmail: string;
	@ApiProperty() subject: string;
	@ApiProperty() template: string;
	@ApiProperty({ enum: EmailLogStatus }) status: EmailLogStatus;
	@ApiProperty() provider: string;
	@ApiPropertyOptional() sentAt: string | null;
	@ApiPropertyOptional() errorMessage: string | null;
	@ApiProperty() createdAt: string;
}

export class AdminAlertResponse {
	@ApiProperty() id: string;
	@ApiProperty() name: string;
	@ApiProperty() ownerEmail: string;
	@ApiProperty() frequency: string;
	@ApiProperty() isActive: boolean;
	@ApiProperty() keywordCount: number;
	@ApiProperty() matchCount: number;
	@ApiPropertyOptional() lastSentAt: string | null;
	@ApiProperty() createdAt: string;
}

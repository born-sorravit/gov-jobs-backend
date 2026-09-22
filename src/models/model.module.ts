import { RefreshTokenRepository } from "@/models/auth/refresh-token.repository";
import { CrawlerRunRepository } from "@/models/crawler/crawler-run.repository";
import { EmailLogRepository } from "@/models/email/email-log.repository";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { JobAttachmentRepository } from "@/models/jobs/job-attachment.repository";
import { JobRepository } from "@/models/jobs/job.repository";
import { ReferenceItemRepository } from "@/models/reference/reference-item.repository";
import { SavedJobRepository } from "@/models/saved-jobs/saved-job.repository";
import { UsersRepository } from "@/models/users/user.repository";
import { Global, Module } from "@nestjs/common";

/**
 * Data layer. Entities and repositories live under `src/models/<domain>/`; feature modules
 * under `src/modules/<feature>/` inject these without re-declaring them, because this
 * module is `@Global()`.
 */
const repositories = [
	// Users
	UsersRepository,
	// Auth
	RefreshTokenRepository,
	// Jobs
	JobRepository,
	JobAttachmentRepository,
	// Saved jobs
	SavedJobRepository,
	// Alerts
	JobAlertRepository,
	JobAlertMatchRepository,
	// Crawler
	CrawlerRunRepository,
	// Email
	EmailLogRepository,
	// Reference taxonomies synced from the source portals
	ReferenceItemRepository,
];

@Global()
@Module({
	providers: [...repositories],
	exports: [...repositories],
})
export class ModelModule {}

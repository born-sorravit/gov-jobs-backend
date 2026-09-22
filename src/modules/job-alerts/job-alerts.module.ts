import { QUEUE_JOB_MATCHING } from "@/constants/queue.constants";
import { AlertMatchingService } from "@/modules/job-alerts/alert-matching.service";
import { JobMatchingProcessor } from "@/modules/job-alerts/job-matching.processor";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { JobAlertsController } from "@/modules/job-alerts/job-alerts.controller";
import { JobAlertsService } from "@/modules/job-alerts/job-alerts.service";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

@Module({
	imports: [
		NotificationsModule,
		BullModule.registerQueue({ name: QUEUE_JOB_MATCHING }),
	],
	controllers: [JobAlertsController],
	providers: [JobAlertsService, AlertMatchingService, JobMatchingProcessor],
	// The crawler runs matching after each import; step 10 moves that behind a queue.
	exports: [JobAlertsService, AlertMatchingService],
})
export class JobAlertsModule {}

import { QUEUE_EMAIL_NOTIFICATION } from "@/constants/queue.constants";
import { EmailModule } from "@/modules/email/email.module";
import { EmailNotificationProcessor } from "@/modules/notifications/email-notification.processor";
import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { NotificationsController } from "@/modules/notifications/notifications.controller";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

@Module({
	imports: [
		EmailModule,
		BullModule.registerQueue({ name: QUEUE_EMAIL_NOTIFICATION }),
	],
	controllers: [NotificationsController],
	providers: [NotificationDispatchService, EmailNotificationProcessor],
	exports: [NotificationDispatchService],
})
export class NotificationsModule {}

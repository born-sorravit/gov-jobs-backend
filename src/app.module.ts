import configuration, { getEnvFilePath } from "@/config/configuration";
import { ModelModule } from "@/models/model.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { AdminModule } from "@/modules/admin/admin.module";
import { CrawlerModule } from "@/modules/crawler/crawler.module";
import { HealthController } from "@/modules/health/health.controller";
import { JobAlertsModule } from "@/modules/job-alerts/job-alerts.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { QueueModule } from "@/modules/queue/queue.module";
import { JobsModule } from "@/modules/jobs/jobs.module";
import { ReferenceModule } from "@/modules/reference/reference.module";
import { SavedJobsModule } from "@/modules/saved-jobs/saved-jobs.module";
import { CacheModule } from "@/shared/cache/cache.module";
import { DatabaseModule } from "@/shared/database/database.module";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { JwtAuthGuard } from "@/shared/guards/jwt-auth.guard";
import { RolesGuard } from "@/shared/guards/roles.guard";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [configuration],
			envFilePath: getEnvFilePath(),
			cache: true,
		}),
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService) => [
				{
					ttl: config.get<number>("security.throttle.ttlSeconds", 60) * 1000,
					limit: config.get<number>("security.throttle.limit", 120),
				},
			],
		}),
		ScheduleModule.forRoot(),
		DatabaseModule,
		CacheModule,
		ModelModule,
		QueueModule,
		CrawlerModule,
		AdminModule,
		AuthModule,
		JobsModule,
		ReferenceModule,
		SavedJobsModule,
		JobAlertsModule,
		NotificationsModule,
	],
	controllers: [HealthController],
	providers: [
		// Order matters: throttling first so a flood is rejected before any crypto work,
		// then authentication, then role checks which need the authenticated user.
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
		{ provide: APP_GUARD, useClass: RolesGuard },
	],
})
export class AppModule {}

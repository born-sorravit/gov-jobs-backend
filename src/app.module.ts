import configuration, { getEnvFilePath } from "@/config/configuration";
import { ModelModule } from "@/models/model.module";
import { CrawlerModule } from "@/modules/crawler/crawler.module";
import { HealthController } from "@/modules/health/health.controller";
import { JobsModule } from "@/modules/jobs/jobs.module";
import { ReferenceModule } from "@/modules/reference/reference.module";
import { DatabaseModule } from "@/shared/database/database.module";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
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
		ModelModule,
		CrawlerModule,
		JobsModule,
		ReferenceModule,
	],
	controllers: [HealthController],
	providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

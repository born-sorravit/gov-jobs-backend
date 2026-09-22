import configuration from "@/config/configuration";
import {
	DEFAULT_JOB_OPTIONS,
	QUEUE_EMAIL_NOTIFICATION,
	QUEUE_JOB_MATCHING,
	QUEUE_OCSC_CRAWLER,
} from "@/constants/queue.constants";
import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPostgresBackend, setDefaultBackendFactory } from "bullmq";

/**
 * Installs the PostgreSQL backend process-wide, before any queue is constructed.
 *
 * Deliberately a module-scope statement rather than something `main.ts` calls: the e2e
 * suites boot `AppModule` directly and never run `main.ts`, so importing this module has to
 * be what installs it. Without this, BullMQ silently falls back to Redis and tries to reach
 * localhost:6379.
 *
 * Why Postgres at all: at BullMQ's defaults a single *idle* worker issues ~605k Redis
 * commands a month against Upstash's free allowance of 500k — a tier problem, not a tuning
 * one. See the Queue and cache section of the README.
 */
setDefaultBackendFactory(createPostgresBackend);

@Global()
@Module({
	imports: [
		BullModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService) => {
				const database =
					config.getOrThrow<ReturnType<typeof configuration>["database"]>(
						"database"
					);
				const queue =
					config.getOrThrow<ReturnType<typeof configuration>["queue"]>("queue");

				return {
					connection: {
						connectionString: database.url,
						ssl: database.ssl,
						schema: queue.schema,
						// BullMQ owns its own tables and migrates them itself; they live in their
						// own schema so TypeORM's diff never sees them.
						migrate: true,
						// Each queue holds a dedicated LISTEN client plus a small pool. Supabase's
						// free tier has a finite connection budget shared with the API.
						max: 3,
					},
					prefix: queue.prefix,
					defaultJobOptions: DEFAULT_JOB_OPTIONS,
				};
			},
		}),
		BullModule.registerQueue(
			{ name: QUEUE_OCSC_CRAWLER },
			{ name: QUEUE_JOB_MATCHING },
			// Registered for producing only. Step 11 adds the processor — a worker with an
			// empty handler would silently acknowledge real work.
			{ name: QUEUE_EMAIL_NOTIFICATION }
		),
	],
	exports: [BullModule],
})
export class QueueModule {}

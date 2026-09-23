import configuration from "@/config/configuration";
import {
	DEFAULT_JOB_OPTIONS,
	QUEUE_DOCUMENT_PROCESSING,
	QUEUE_EMAIL_NOTIFICATION,
	QUEUE_JOB_MATCHING,
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
						/**
						 * **One** pooled connection per queue and per worker, not three.
						 *
						 * Every `Queue` and every `Worker` opens its own pool against the same
						 * Postgres, and a worker additionally holds a dedicated LISTEN client that
						 * cannot be shared. Supabase's session pooler allows 15 clients in total,
						 * shared with the API's own pool — measured at **17 in flight** during a
						 * crawl that enqueued 52 matching jobs and 50 documents, which is what
						 * `max clients reached in session mode` was reporting.
						 *
						 * One is enough: each of these pools serves a single worker loop, and the
						 * work is queued rather than latency-sensitive.
						 */
						max: 1,
					},
					prefix: queue.prefix,
					defaultJobOptions: DEFAULT_JOB_OPTIONS,
				};
			},
		}),
		// `ocsc-crawler` used to be registered here and never had a producer or a processor —
		// a queue nobody posted to, holding a connection against a budget of 15.
		BullModule.registerQueue(
			{ name: QUEUE_JOB_MATCHING },
			{ name: QUEUE_EMAIL_NOTIFICATION },
			{ name: QUEUE_DOCUMENT_PROCESSING }
		),
	],
	exports: [BullModule],
})
export class QueueModule {}

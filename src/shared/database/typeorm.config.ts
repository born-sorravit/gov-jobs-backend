import configuration, { loadEnv } from "@/config/configuration";

const toInt = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isNaN(parsed) ? fallback : parsed;
};
import { DataSource, DataSourceOptions } from "typeorm";

loadEnv();

const config = configuration().database;

/**
 * Shared by the runtime (`DatabaseModule`), the TypeORM CLI and the e2e tests.
 *
 * The glob has to follow whichever copy of the code is executing. Loading entities from
 * `dist/` while the caller imported the TypeScript class registers two different classes
 * for the same table, and TypeORM then reports "No metadata for X was found" — which is
 * exactly what ts-jest and ts-node hit. Keying off this file's own extension picks the
 * right tree automatically: `.js` when running compiled output, `.ts` under ts-jest.
 */
const runningFromSource = __filename.endsWith(".ts");
const root = runningFromSource ? "src" : "dist";
const ext = runningFromSource ? "ts" : "js";

export const dataSourceOptions: DataSourceOptions = {
	type: "postgres",
	url: config.url,
	synchronize: config.synchronize,
	logging: config.logging,
	ssl: config.ssl,
	entities: [`${root}/models/**/*.entity.${ext}`],
	migrations: [`${root}/shared/database/migrations/*.${ext}`],
	/**
	 * node-postgres defaults to 10, which is most of Supabase's session-pooler budget of 15
	 * before BullMQ has opened anything. Each queue and each worker holds its own pool plus,
	 * for a worker, a LISTEN client that cannot be shared — measured at 17 clients in flight
	 * during a crawl, which is what `max clients reached in session mode` was reporting.
	 *
	 * Three, measured: with one connection per queue and per worker, a crawl that enqueued 53
	 * matching jobs and 50 documents while ten API requests ran concurrently peaked at **11**
	 * clients — four below the ceiling, which is the room a deploy's migration step and a
	 * brief old/new instance overlap need.
	 */
	extra: { max: toInt(process.env.DB_POOL_MAX, 3) },
};

export const dataSource = new DataSource(dataSourceOptions);

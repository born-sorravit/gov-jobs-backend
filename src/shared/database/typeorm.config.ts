import configuration, { loadEnv } from "@/config/configuration";
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
};

export const dataSource = new DataSource(dataSourceOptions);

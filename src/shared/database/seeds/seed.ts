import { ReferenceKind } from "@/models/reference/entities/reference-item.entity";
import {
	OCSC_REFERENCE_ENDPOINTS,
	RawReferenceRow,
	toReferenceItems,
	upsertReferenceItems,
} from "@/shared/database/seeds/reference.seed";
import { dataSourceOptions } from "@/shared/database/typeorm.config";
import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

/**
 * Seeds the reference taxonomies from the live OCSC lookup endpoints.
 *
 * Safe to re-run: every row is upserted on `(source, kind, external_id)`. The crawler
 * refreshes the same tables on each run, so this is really a bootstrap convenience — and
 * the only thing that fills in our English labels.
 */
const seed = async (): Promise<void> => {
	const logger = new Logger("Seed");
	const baseUrl =
		process.env.OCSC_API_BASE_URL ?? "https://jobapp.ocsc.go.th/jobapi";

	// Entities resolve from dist/, matching the datasource globs.
	const dataSource = new DataSource(dataSourceOptions);
	await dataSource.initialize();

	try {
		for (const endpoint of OCSC_REFERENCE_ENDPOINTS) {
			const response = await fetch(`${baseUrl}${endpoint.path}`);
			if (!response.ok) {
				throw new Error(`GET ${endpoint.path} returned ${response.status}`);
			}

			const rows = (await response.json()) as RawReferenceRow[];
			const items = toReferenceItems(endpoint.kind, endpoint.labelField, rows);
			const count = await upsertReferenceItems(dataSource, items);
			logger.log(`${ReferenceKind[endpoint.kind]}: ${count} rows`);
		}

		logger.log("Reference seed complete");
	} finally {
		await dataSource.destroy();
	}
};

seed().catch((error) => {
	new Logger("Seed").error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { dataSourceOptions } from "@/shared/database/typeorm.config";
import { JobSource } from "@/shared/enums/job-source.enum";
import { JobStatus } from "@/shared/enums/job-status.enum";
import {
	jobStatusSqlExpression,
	resolveJobStatus,
} from "@/shared/utils/job-status.util";
import { DataSource, Repository } from "typeorm";

/**
 * Job status exists twice — once in TypeScript for anything already loaded, once in SQL for
 * filtering and sorting. The whole point is that they agree, so this pins the boundaries
 * against a real Postgres rather than a mock.
 *
 * Requires a database (`docker compose up -d && npm run migration:run`).
 */
describe("job status: SQL and TypeScript agree", () => {
	const today = "2026-10-10";
	const cases: {
		name: string;
		start: string | null;
		end: string | null;
		expected: JobStatus;
	}[] = [
		{
			name: "upcoming",
			start: "2026-10-11",
			end: "2026-10-26",
			expected: JobStatus.UPCOMING,
		},
		{
			name: "first-day",
			start: "2026-10-10",
			end: "2026-10-26",
			expected: JobStatus.OPEN,
		},
		{
			name: "last-day",
			start: "2026-10-01",
			end: "2026-10-10",
			expected: JobStatus.OPEN,
		},
		{
			name: "day-after",
			start: "2026-10-01",
			end: "2026-10-09",
			expected: JobStatus.CLOSED,
		},
		{ name: "no-start", start: null, end: "2026-10-26", expected: JobStatus.OPEN },
		{ name: "no-end", start: "2026-10-01", end: null, expected: JobStatus.OPEN },
		{ name: "no-dates", start: null, end: null, expected: JobStatus.OPEN },
	];

	let dataSource: DataSource;
	let jobs: Repository<Job>;
	let sqlStatuses: Record<string, string>;

	beforeAll(async () => {
		// The shared options resolve entities from dist/ by glob. Under ts-jest we are the
		// TypeScript class, so the entity is registered explicitly — otherwise TypeORM holds
		// metadata for a different Job class than the one this file imported.
		dataSource = await new DataSource({
			...dataSourceOptions,
			entities: [Job, JobAttachment],
		}).initialize();
		jobs = dataSource.getRepository(Job);

		for (const { name, start, end } of cases) {
			await jobs.insert({
				source: JobSource.OCSC,
				externalId: `status-parity-${name}`,
				title: name,
				agency: "status-parity-fixture",
				sourceUrl: "https://example.test",
				contentHash: `status-parity-${name}`,
				applicationStart: start,
				applicationEnd: end,
			});
		}

		const rows = await jobs
			.createQueryBuilder("job")
			.select("job.external_id", "id")
			.addSelect(jobStatusSqlExpression("job"), "status")
			.where("job.agency = :agency", { agency: "status-parity-fixture" })
			.setParameter("today", today)
			.getRawMany<{ id: string; status: string }>();

		sqlStatuses = Object.fromEntries(rows.map((row) => [row.id, row.status]));
	}, 30_000);

	afterAll(async () => {
		if (!dataSource?.isInitialized) return;
		await jobs.delete({ agency: "status-parity-fixture" });
		await dataSource.destroy();
	});

	it.each(cases)("$name", ({ name, start, end, expected }) => {
		const fromSql = sqlStatuses[`status-parity-${name}`];
		const fromTypeScript = resolveJobStatus(
			{ applicationStart: start, applicationEnd: end },
			today
		);

		expect(fromTypeScript).toBe(expected);
		// If :today were ever left unbound this is what would catch it.
		expect(fromSql).toBe(expected);
	});
});

import { MigrationInterface, QueryRunner } from "typeorm";

export class CrawlerRunGuards1790003984461 implements MigrationInterface {
	name = "CrawlerRunGuards1790003984461";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "crawler_run" ADD "unchanged_jobs" integer NOT NULL DEFAULT '0'`
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_crawler_run_active" ON "crawler_run"  ("source") WHERE status = 'RUNNING'`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."uq_crawler_run_active"`);
		await queryRunner.query(
			`ALTER TABLE "crawler_run" DROP COLUMN "unchanged_jobs"`
		);
	}
}

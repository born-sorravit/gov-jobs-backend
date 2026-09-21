import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * `GET /jobs?q=` searches title, agency **and** ministry. The first two got trigram indexes
 * in the initial schema; without this one the ministry arm of that OR is a sequential scan.
 *
 * Hand-written because TypeORM has no way to express an operator class; the column carries
 * `@Index(..., { synchronize: false })` so the schema differ leaves it alone.
 */
export class MinistryTrigramIndex1789990000000 implements MigrationInterface {
	name = "MinistryTrigramIndex1789990000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE INDEX "idx_job_ministry_trgm" ON "job" USING GIN ("ministry" gin_trgm_ops)`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."idx_job_ministry_trgm"`);
	}
}

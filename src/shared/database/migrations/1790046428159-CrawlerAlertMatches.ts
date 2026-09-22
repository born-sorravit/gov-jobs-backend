import { MigrationInterface, QueryRunner } from "typeorm";

export class CrawlerAlertMatches1790046428159 implements MigrationInterface {
	name = "CrawlerAlertMatches1790046428159";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "crawler_run" ADD "alert_matches" integer NOT NULL DEFAULT '0'`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "crawler_run" DROP COLUMN "alert_matches"`);
	}
}

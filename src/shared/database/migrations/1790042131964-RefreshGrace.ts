import { MigrationInterface, QueryRunner } from "typeorm";

export class RefreshGrace1790042131964 implements MigrationInterface {
	name = "RefreshGrace1790042131964";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "refresh_token" ADD "revoked_reason" character varying(16)`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "refresh_token" DROP COLUMN "revoked_reason"`
		);
	}
}

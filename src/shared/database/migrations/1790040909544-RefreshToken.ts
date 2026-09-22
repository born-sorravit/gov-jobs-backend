import { MigrationInterface, QueryRunner } from "typeorm";

export class RefreshToken1790040909544 implements MigrationInterface {
	name = "RefreshToken1790040909544";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "refresh_token" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "token_hash" character varying(64) NOT NULL, "user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "user_agent" character varying(255), CONSTRAINT "PK_b575dd3c21fb0831013c909e7fe" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_refresh_token_hash" ON "refresh_token"  ("token_hash") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_refresh_token_user_id" ON "refresh_token"  ("user_id") `
		);
		await queryRunner.query(
			`ALTER TABLE "refresh_token" ADD CONSTRAINT "FK_6bbe63d2fe75e7f0ba1710351d4" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "refresh_token" DROP CONSTRAINT "FK_6bbe63d2fe75e7f0ba1710351d4"`
		);
		await queryRunner.query(`DROP INDEX "public"."idx_refresh_token_user_id"`);
		await queryRunner.query(`DROP INDEX "public"."uq_refresh_token_hash"`);
		await queryRunner.query(`DROP TABLE "refresh_token"`);
	}
}

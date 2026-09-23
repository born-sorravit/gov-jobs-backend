import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Gives `job_attachment` somewhere to record what reading the document produced.
 *
 * Existing rows land in `PENDING`, which is correct: they were imported before anything read
 * them, and the worker will pick them up on its next sweep.
 */
export class DocumentExtraction1790127938965 implements MigrationInterface {
	name = "DocumentExtraction1790127938965";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."job_attachment_extraction_status_enum" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'INSUFFICIENT_TEXT', 'FAILED')`
		);
		await queryRunner.query(
			`CREATE TYPE "public"."job_attachment_extraction_method_enum" AS ENUM('TEXT', 'OCR')`
		);

		await queryRunner.query(
			`ALTER TABLE "job_attachment"
			 ADD "extraction_status" "public"."job_attachment_extraction_status_enum" NOT NULL DEFAULT 'PENDING',
			 ADD "extraction_method" "public"."job_attachment_extraction_method_enum",
			 ADD "extracted_text" text,
			 ADD "extraction_error" text,
			 ADD "file_hash" character varying(64),
			 ADD "file_size" integer,
			 ADD "processed_at" TIMESTAMP WITH TIME ZONE`
		);

		// The worker's only query is "what is still PENDING"; OCR's will be "what is
		// INSUFFICIENT_TEXT". Both look for a handful of rows in a table that only grows.
		await queryRunner.query(
			`CREATE INDEX "idx_job_attachment_extraction_status" ON "job_attachment" ("extraction_status")`
		);
		// Sources republish one file under several announcements; this is what makes "have we
		// already read these bytes?" answerable without fetching them again.
		await queryRunner.query(
			`CREATE INDEX "idx_job_attachment_file_hash" ON "job_attachment" ("file_hash")`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."idx_job_attachment_file_hash"`);
		await queryRunner.query(
			`DROP INDEX "public"."idx_job_attachment_extraction_status"`
		);
		await queryRunner.query(
			`ALTER TABLE "job_attachment"
			 DROP COLUMN "processed_at",
			 DROP COLUMN "file_size",
			 DROP COLUMN "file_hash",
			 DROP COLUMN "extraction_error",
			 DROP COLUMN "extracted_text",
			 DROP COLUMN "extraction_method",
			 DROP COLUMN "extraction_status"`
		);
		await queryRunner.query(
			`DROP TYPE "public"."job_attachment_extraction_method_enum"`
		);
		await queryRunner.query(
			`DROP TYPE "public"."job_attachment_extraction_status_enum"`
		);
	}
}

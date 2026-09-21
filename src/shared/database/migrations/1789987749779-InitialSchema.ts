import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1789987749779 implements MigrationInterface {
	name = "InitialSchema1789987749779";

	public async up(queryRunner: QueryRunner): Promise<void> {
		// uuid_generate_v4() for primary keys; pg_trgm for the ILIKE keyword search below.
		await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
		await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
		await queryRunner.query(
			`CREATE TYPE "public"."crawler_run_source_enum" AS ENUM('OCSC')`
		);
		await queryRunner.query(
			`CREATE TYPE "public"."crawler_run_status_enum" AS ENUM('RUNNING', 'SUCCESS', 'FAILED')`
		);
		await queryRunner.query(
			`CREATE TABLE "crawler_run" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "source" "public"."crawler_run_source_enum" NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, "status" "public"."crawler_run_status_enum" NOT NULL DEFAULT 'RUNNING', "total_found" integer NOT NULL DEFAULT '0', "new_jobs" integer NOT NULL DEFAULT '0', "updated_jobs" integer NOT NULL DEFAULT '0', "skipped_jobs" integer NOT NULL DEFAULT '0', "error_message" text, "trigger" character varying(32) NOT NULL DEFAULT 'manual', CONSTRAINT "PK_250f5bd227208022922570056ba" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_crawler_run_source_started_at" ON "crawler_run"  ("source", "started_at") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."email_log_status_enum" AS ENUM('QUEUED', 'SENT', 'FAILED')`
		);
		await queryRunner.query(
			`CREATE TABLE "email_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "to_email" character varying(255) NOT NULL, "subject" character varying(500) NOT NULL, "template" character varying(64) NOT NULL, "status" "public"."email_log_status_enum" NOT NULL DEFAULT 'QUEUED', "provider" character varying(32) NOT NULL, "provider_message_id" character varying(255), "job_alert_id" uuid, "user_id" uuid, "sent_at" TIMESTAMP WITH TIME ZONE, "error_message" text, CONSTRAINT "PK_edfd3f7225051fc07bdd63a22dc" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_email_log_to_email" ON "email_log"  ("to_email") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_email_log_created_at" ON "email_log"  ("created_at") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."user_role_enum" AS ENUM('USER', 'ADMIN')`
		);
		await queryRunner.query(
			`CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "name" character varying(120) NOT NULL, "role" "public"."user_role_enum" NOT NULL DEFAULT 'USER', "is_verified" boolean NOT NULL DEFAULT false, "locale" character varying(5) NOT NULL DEFAULT 'th', CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_user_email" ON "user"  ("email") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."alert_frequency_enum" AS ENUM('IMMEDIATE', 'DAILY', 'WEEKLY')`
		);
		await queryRunner.query(
			`CREATE TABLE "job_alert" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "user_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "keywords" text array NOT NULL DEFAULT '{}', "job_types" integer array NOT NULL DEFAULT '{}', "educations" integer array NOT NULL DEFAULT '{}', "provinces" integer array NOT NULL DEFAULT '{}', "notification_email" character varying(255) NOT NULL, "frequency" "public"."alert_frequency_enum" NOT NULL DEFAULT 'IMMEDIATE', "is_active" boolean NOT NULL DEFAULT true, "match_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_sent_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_af0351e285e96d8b1720080a71d" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_alert_user_id" ON "job_alert"  ("user_id") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."job_attachment_type_enum" AS ENUM('ANNOUNCEMENT_PDF', 'OTHER')`
		);
		await queryRunner.query(
			`CREATE TABLE "job_attachment" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "job_id" uuid NOT NULL, "name" character varying(500) NOT NULL, "url" text NOT NULL, "type" "public"."job_attachment_type_enum" NOT NULL DEFAULT 'OTHER', CONSTRAINT "uq_job_attachment_job_url" UNIQUE ("job_id", "url"), CONSTRAINT "PK_a99dc5a08406f07b7f92fba3819" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_attachment_job_id" ON "job_attachment"  ("job_id") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."job_source_enum" AS ENUM('OCSC')`
		);
		await queryRunner.query(
			`CREATE TABLE "job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "source" "public"."job_source_enum" NOT NULL, "external_id" character varying(120) NOT NULL, "title" character varying(500) NOT NULL, "agency" character varying(500) NOT NULL, "ministry" character varying(500), "agency_external_id" integer, "agency_seal_url" text, "job_category_id" integer, "job_category_other" text, "job_type_id" integer, "job_type_other" text, "job_level_id" integer, "job_level_other" text, "job_selection_id" integer, "job_selection_other" text, "job_condition_id" integer, "job_condition_other" text, "province_ids" integer array NOT NULL DEFAULT '{}', "education_level_ids" integer array NOT NULL DEFAULT '{}', "education_level_other" text, "description" text, "education_requirements" text, "knowledge" text, "skill" text, "competency" text, "criteria" text, "salary_min" integer, "salary_max" integer, "position_amount" integer, "application_start" date, "application_end" date, "exam_date" date, "interview_date" date, "published_at" TIMESTAMP WITH TIME ZONE, "source_url" text NOT NULL, "apply_url" text, "content_hash" character varying(64) NOT NULL, "raw_payload" jsonb, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_job_source_external_id" UNIQUE ("source", "external_id"), CONSTRAINT "PK_98ab1c14ff8d1cf80d18703b92f" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_first_seen_at" ON "job"  ("first_seen_at") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_education_level_ids" ON "job" USING gin ("education_level_ids") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_province_ids" ON "job" USING gin ("province_ids") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_source_published_at" ON "job"  ("source", "published_at") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_published_at" ON "job"  ("published_at") `
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_application_end" ON "job"  ("application_end") `
		);
		await queryRunner.query(
			`CREATE TABLE "job_alert_match" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "job_alert_id" uuid NOT NULL, "job_id" uuid NOT NULL, "matched_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "notified_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_job_alert_match_alert_job" UNIQUE ("job_alert_id", "job_id"), CONSTRAINT "PK_39528d0451bef926687ca81055a" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_alert_match_pending" ON "job_alert_match"  ("job_alert_id", "notified_at") `
		);
		await queryRunner.query(
			`CREATE TYPE "public"."reference_item_source_enum" AS ENUM('OCSC')`
		);
		await queryRunner.query(
			`CREATE TYPE "public"."reference_kind_enum" AS ENUM('PROVINCE', 'EDUCATION_LEVEL', 'JOB_TYPE', 'JOB_CATEGORY', 'JOB_LEVEL', 'JOB_SELECTION', 'JOB_CONDITION')`
		);
		await queryRunner.query(
			`CREATE TABLE "reference_item" ("source" "public"."reference_item_source_enum" NOT NULL, "kind" "public"."reference_kind_enum" NOT NULL, "external_id" integer NOT NULL, "name_th" character varying(255) NOT NULL, "name_en" character varying(255), "sort_order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3a7ffbc96163b936e5fea080045" PRIMARY KEY ("source", "kind", "external_id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_af7020b0e5d501f7255959c21e" ON "reference_item"  ("kind", "external_id") `
		);
		await queryRunner.query(
			`CREATE TABLE "saved_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "user_id" uuid NOT NULL, "job_id" uuid NOT NULL, CONSTRAINT "uq_saved_job_user_job" UNIQUE ("user_id", "job_id"), CONSTRAINT "PK_eec7a26a4f0a651ab3d63c2a4a6" PRIMARY KEY ("id"))`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_saved_job_user_id" ON "saved_job"  ("user_id") `
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert" ADD CONSTRAINT "FK_eb6e86274f8555f518505c12d72" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "job_attachment" ADD CONSTRAINT "FK_da95aaf093e8c9841af6306ed52" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert_match" ADD CONSTRAINT "FK_6ee540ad739de02fdc28ed454b2" FOREIGN KEY ("job_alert_id") REFERENCES "job_alert"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert_match" ADD CONSTRAINT "FK_98ae7488988603557d6f216fbe2" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "saved_job" ADD CONSTRAINT "FK_dc2c64f40719148d79921d424ba" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`ALTER TABLE "saved_job" ADD CONSTRAINT "FK_d7e38cdc6dc7765b30447cd06d4" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_title_trgm" ON "job" USING GIN ("title" gin_trgm_ops)`
		);
		await queryRunner.query(
			`CREATE INDEX "idx_job_agency_trgm" ON "job" USING GIN ("agency" gin_trgm_ops)`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."idx_job_agency_trgm"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_title_trgm"`);
		await queryRunner.query(
			`ALTER TABLE "saved_job" DROP CONSTRAINT "FK_d7e38cdc6dc7765b30447cd06d4"`
		);
		await queryRunner.query(
			`ALTER TABLE "saved_job" DROP CONSTRAINT "FK_dc2c64f40719148d79921d424ba"`
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert_match" DROP CONSTRAINT "FK_98ae7488988603557d6f216fbe2"`
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert_match" DROP CONSTRAINT "FK_6ee540ad739de02fdc28ed454b2"`
		);
		await queryRunner.query(
			`ALTER TABLE "job_attachment" DROP CONSTRAINT "FK_da95aaf093e8c9841af6306ed52"`
		);
		await queryRunner.query(
			`ALTER TABLE "job_alert" DROP CONSTRAINT "FK_eb6e86274f8555f518505c12d72"`
		);
		await queryRunner.query(`DROP INDEX "public"."idx_saved_job_user_id"`);
		await queryRunner.query(`DROP TABLE "saved_job"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_af7020b0e5d501f7255959c21e"`);
		await queryRunner.query(`DROP TABLE "reference_item"`);
		await queryRunner.query(`DROP TYPE "public"."reference_kind_enum"`);
		await queryRunner.query(`DROP TYPE "public"."reference_item_source_enum"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_alert_match_pending"`);
		await queryRunner.query(`DROP TABLE "job_alert_match"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_application_end"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_published_at"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_source_published_at"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_province_ids"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_education_level_ids"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_first_seen_at"`);
		await queryRunner.query(`DROP TABLE "job"`);
		await queryRunner.query(`DROP TYPE "public"."job_source_enum"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_attachment_job_id"`);
		await queryRunner.query(`DROP TABLE "job_attachment"`);
		await queryRunner.query(`DROP TYPE "public"."job_attachment_type_enum"`);
		await queryRunner.query(`DROP INDEX "public"."idx_job_alert_user_id"`);
		await queryRunner.query(`DROP TABLE "job_alert"`);
		await queryRunner.query(`DROP TYPE "public"."alert_frequency_enum"`);
		await queryRunner.query(`DROP INDEX "public"."uq_user_email"`);
		await queryRunner.query(`DROP TABLE "user"`);
		await queryRunner.query(`DROP TYPE "public"."user_role_enum"`);
		await queryRunner.query(`DROP INDEX "public"."idx_email_log_created_at"`);
		await queryRunner.query(`DROP INDEX "public"."idx_email_log_to_email"`);
		await queryRunner.query(`DROP TABLE "email_log"`);
		await queryRunner.query(`DROP TYPE "public"."email_log_status_enum"`);
		await queryRunner.query(
			`DROP INDEX "public"."idx_crawler_run_source_started_at"`
		);
		await queryRunner.query(`DROP TABLE "crawler_run"`);
		await queryRunner.query(`DROP TYPE "public"."crawler_run_status_enum"`);
		await queryRunner.query(`DROP TYPE "public"."crawler_run_source_enum"`);
	}
}

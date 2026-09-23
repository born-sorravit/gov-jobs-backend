import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Closes the two gaps that let an alert email reach someone who never asked for it.
 *
 * 1. `unsubscribe_token` — a bearer secret so the person holding the email can switch the
 *    alert off without an account. Until now the only way to stop one was to sign in as its
 *    owner, which a third-party recipient by definition cannot do.
 * 2. `notification_email` is reset to the owner's address. The API used to let a client name
 *    any recipient, so a row where the two differ is exactly the case being closed.
 */
export class AlertUnsubscribe1790083599925 implements MigrationInterface {
	name = "AlertUnsubscribe1790083599925";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "job_alert" ADD "unsubscribe_token" character varying(64)`
		);

		/**
		 * Backfilled in SQL so the column can be NOT NULL in the same migration.
		 *
		 * `gen_random_uuid()` is core since PostgreSQL 13 (no pgcrypto needed) and is CSPRNG
		 * backed. Two of them stripped of their dashes give 244 random bits — six are fixed by
		 * the UUID version and variant — which is past guessing by any margin that matters, and
		 * in the same class as the `randomBytes(32)` the application uses for new rows. The
		 * alphabet differs from base64url, which is fine: nothing parses these, they are only
		 * ever compared.
		 */
		await queryRunner.query(
			`UPDATE "job_alert"
			 SET "unsubscribe_token" =
			     replace(gen_random_uuid()::text, '-', '') ||
			     replace(gen_random_uuid()::text, '-', '')
			 WHERE "unsubscribe_token" IS NULL`
		);

		await queryRunner.query(
			`ALTER TABLE "job_alert" ALTER COLUMN "unsubscribe_token" SET NOT NULL`
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_job_alert_unsubscribe_token" ON "job_alert" ("unsubscribe_token")`
		);

		/**
		 * Deliberately changes where some existing alerts deliver.
		 *
		 * That is the point: every row this touches is one addressed somewhere other than the
		 * account that owns it, which is the delivery this release stops allowing. The owner
		 * keeps the alert and keeps receiving it — at their own address.
		 */
		await queryRunner.query(
			`UPDATE "job_alert" AS a
			 SET "notification_email" = u."email"
			 FROM "user" AS u
			 WHERE u."id" = a."user_id" AND a."notification_email" IS DISTINCT FROM u."email"`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// The reset above is not reversible: the addresses it replaced are not recorded
		// anywhere, and reinstating third-party delivery is not something to automate.
		await queryRunner.query(`DROP INDEX "public"."uq_job_alert_unsubscribe_token"`);
		await queryRunner.query(
			`ALTER TABLE "job_alert" DROP COLUMN "unsubscribe_token"`
		);
	}
}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Widens the three `JobSource` enum types to the Tier 1 sources.
 *
 * `source` is modelled as a separate Postgres enum per table rather than one shared type —
 * that is what TypeORM generated — so every one of them has to be widened in step or a
 * `crawler_run` could never record a source its `job` rows are allowed to have.
 */
const SOURCE_ENUM_TYPES = [
	"job_source_enum",
	"crawler_run_source_enum",
	"reference_item_source_enum",
] as const;

/** Added by this migration. `OCSC` predates it and must keep its ordinal position. */
const NEW_SOURCES = ["DOL", "ADMIN_COURT", "DOE", "MDES"] as const;

/** Which column each enum type backs, for the rebuild in `down`. */
const SOURCE_COLUMNS: Record<(typeof SOURCE_ENUM_TYPES)[number], [string, string]> =
	{
		job_source_enum: ["job", "source"],
		crawler_run_source_enum: ["crawler_run", "source"],
		reference_item_source_enum: ["reference_item", "source"],
	};

export class MultiSourceEnums1790079845524 implements MigrationInterface {
	name = "MultiSourceEnums1790079845524";

	/**
	 * `ALTER TYPE ... ADD VALUE` inside TypeORM's migration transaction is only legal from
	 * PostgreSQL 12 onwards, and only while the new value goes unused until the transaction
	 * commits. Both hold: the deployment targets PG 15+, and nothing here writes a row.
	 *
	 * `IF NOT EXISTS` makes a partially-applied migration safe to replay, which matters
	 * because a failure part-way through this loop cannot be rolled back by value.
	 */
	public async up(queryRunner: QueryRunner): Promise<void> {
		for (const type of SOURCE_ENUM_TYPES) {
			for (const source of NEW_SOURCES) {
				await queryRunner.query(
					`ALTER TYPE "public"."${type}" ADD VALUE IF NOT EXISTS '${source}'`
				);
			}
		}
	}

	/**
	 * Postgres cannot drop a value from an enum, so the type is rebuilt without them.
	 *
	 * `USING source::text::<new type>` fails loudly if any row already holds one of the new
	 * values — which is the correct outcome. Reverting past the point where a second source
	 * imported announcements means deciding what happens to those rows, and silently
	 * discarding them here would be the worst of the available answers.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		for (const type of SOURCE_ENUM_TYPES) {
			const [table, column] = SOURCE_COLUMNS[type];

			await queryRunner.query(`CREATE TYPE "public"."${type}_old" AS ENUM('OCSC')`);
			await queryRunner.query(
				`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "public"."${type}_old" ` +
					`USING "${column}"::text::"public"."${type}_old"`
			);
			await queryRunner.query(`DROP TYPE "public"."${type}"`);
			await queryRunner.query(
				`ALTER TYPE "public"."${type}_old" RENAME TO "${type}"`
			);
		}
	}
}

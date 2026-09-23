import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Canonicalises the two spellings of `ำ` in text that is compared as text.
 *
 * Thai portals write SARA AM either as `ำ` (U+0E33) or as NIKHAHIT + SARA AA
 * (U+0E4D U+0E32) — MDES uses both on a single listing page. The two look identical to a
 * reader and are different strings to Postgres, so an alert whose keyword is written one way
 * silently never matches announcements published the other way.
 *
 * `ำ` has no canonical Unicode decomposition, so `normalize()` cannot do this and neither
 * can Postgres' own collation: it has to be an explicit substitution, applied to announcement
 * text and to saved keywords alike.
 */

/**
 * NIKHAHIT, an optional tone mark, then SARA AA — replaced by the tone plus SARA AM.
 *
 * Written as literal characters rather than escapes: Postgres' `regexp_replace` has no
 * `\uXXXX` syntax and would substitute the six-character text instead of the codepoint.
 * `\1` is a backreference and does belong in the replacement.
 */
const DECOMPOSED = "\u0E4D([\u0E48-\u0E4C]?)\u0E32";
const COMPOSED = "\\1\u0E33";

/** `regexp_replace(col, …, 'g')`, guarded so unaffected rows are not rewritten. */
const fix = (table: string, column: string): string =>
	`UPDATE "${table}"
	 SET "${column}" = regexp_replace("${column}", '${DECOMPOSED}', '${COMPOSED}', 'g')
	 WHERE "${column}" ~ '${DECOMPOSED}'`;

const JOB_TEXT_COLUMNS = [
	"title",
	"agency",
	"ministry",
	"job_category_other",
	"job_type_other",
	"job_level_other",
	"job_selection_other",
	"job_condition_other",
	"education_level_other",
	"description",
	"education_requirements",
	"knowledge",
	"skill",
	"competency",
	"criteria",
];

export class NormalizeThaiText1790086389682 implements MigrationInterface {
	name = "NormalizeThaiText1790086389682";

	public async up(queryRunner: QueryRunner): Promise<void> {
		for (const column of JOB_TEXT_COLUMNS) {
			await queryRunner.query(fix("job", column));
		}
		await queryRunner.query(fix("job_attachment", "name"));

		/**
		 * Keywords are a `text[]`, so the substitution runs per element and the array is
		 * rebuilt. Only rows that actually contain the two-codepoint spelling are touched —
		 * `array_agg` over an empty array would otherwise turn `{}` into NULL.
		 */
		await queryRunner.query(
			`UPDATE "job_alert" AS a
			 SET "keywords" = normalized.keywords
			 FROM (
				 SELECT j."id",
				        array_agg(
				            regexp_replace(k, '${DECOMPOSED}', '${COMPOSED}', 'g')
				            ORDER BY ord
				        ) AS keywords
				 FROM "job_alert" j, unnest(j."keywords") WITH ORDINALITY AS t(k, ord)
				 GROUP BY j."id"
			 ) AS normalized
			 WHERE normalized."id" = a."id"
			   AND EXISTS (
			       SELECT 1 FROM unnest(a."keywords") AS k WHERE k ~ '${DECOMPOSED}'
			   )`
		);

		/**
		 * `content_hash` is computed over the normalised text, so every row this migration
		 * rewrote now disagrees with its stored hash. Clearing it is wrong (the column is NOT
		 * NULL and drives dedup); leaving it means the next crawl sees a mismatch and records
		 * the announcement as *updated* — which is accurate, re-enqueues matching for it, and
		 * is deduplicated downstream by `uq_job_alert_match_alert_job`. No action needed here
		 * beyond knowing the first crawl after this deploy reports a larger `updated_jobs`.
		 */
	}

	/**
	 * Not reversible, and deliberately so: the original spelling is not recorded, and
	 * re-splitting every `ำ` would corrupt the rows that were always canonical.
	 */
	public async down(): Promise<void> {
		// Intentionally empty.
	}
}

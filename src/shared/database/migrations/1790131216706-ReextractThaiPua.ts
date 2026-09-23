import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Queues every document whose text carries Thai Private Use Area marks to be read again.
 *
 * Thai PDFs are produced with fonts that place tone marks and vowels at U+F700–U+F71A so the
 * glyph sits at the right height above a tall consonant. The extractor read exactly what the
 * font said, so text stored before `normalizeThaiText` learned to translate them looks
 * correct to a human and matches nothing: `ตำแหน่ง` occurred 39 times across the extracted
 * corpus, and 533 once the marks are restored.
 *
 * Resetting to PENDING rather than rewriting the text in SQL: re-reading the document with
 * the corrected reader produces the right answer once, where a SQL translation would be a
 * second implementation of the same table to keep in step.
 */
export class ReextractThaiPua1790131216706 implements MigrationInterface {
	name = "ReextractThaiPua1790131216706";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`UPDATE "job_attachment"
			 SET "extraction_status" = 'PENDING'
			 WHERE "extracted_text" ~ ('[' || U&'\\+00F700' || '-' || U&'\\+00F71A' || ']')`
		);
	}

	/**
	 * Not reversible, and harmless: the rows are re-read on the next crawl either way, and
	 * putting deliberately worse text back is not something to automate.
	 */
	public async down(): Promise<void> {
		// Intentionally empty.
	}
}

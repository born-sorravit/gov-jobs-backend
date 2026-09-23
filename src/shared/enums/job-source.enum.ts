/**
 * Every crawlable announcement source. `(source, externalId)` is unique on `job`, so ids
 * from different portals can never collide. Adding a source = adding a value here plus a
 * `JobSourceCrawler` implementation registered in `CrawlerModule`.
 *
 * A value may exist here before its crawler does — the enum is a database type shared by
 * `job`, `crawler_run` and `reference_item`, and widening it is a migration, so the values
 * land ahead of the code that fills them. `CrawlerRegistry` is the source of truth for what
 * can actually be crawled today; `run-all` iterates that, never this.
 */
export enum JobSource {
	/** สำนักงาน ก.พ. — the OCSC central job portal. */
	OCSC = "OCSC",
	/** กรมที่ดิน */
	DOL = "DOL",
	/** สำนักงานศาลปกครอง */
	ADMIN_COURT = "ADMIN_COURT",
	/** กรมการจัดหางาน */
	DOE = "DOE",
	/** กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม */
	MDES = "MDES",
}

/**
 * Every crawlable announcement source. `(source, externalId)` is unique on `job`, so ids
 * from different portals can never collide. Adding a source = adding a value here plus a
 * `JobSourceCrawler` implementation.
 */
export enum JobSource {
	OCSC = "OCSC",
}

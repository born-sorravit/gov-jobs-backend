import { Configuration } from "@/config/configuration";
import {
	DOL_AGENCY,
	normalizeDolJob,
	parseDolAnnouncement,
	parseDolListing,
} from "@/modules/crawler/dol/dol.parser";
import { isRecruitmentAnnouncement } from "@/modules/crawler/recruitment-title";
import { DolListingEntry } from "@/modules/crawler/dol/dol.types";
import {
	CrawlResult,
	JobSourceCrawler,
	NormalizedJob,
	RejectedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	JobValidationError,
	SourceUnavailableError,
} from "@/modules/crawler/normalization";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * กรมที่ดิน.
 *
 * DOL publishes no API, so this reads the same HTML a visitor sees: a paginated news listing
 * for the personnel division, then one announcement page per entry for its PDF. Everything
 * source-specific lives in `DolParser`; this class only fetches, filters and reports.
 */
@Injectable()
export class DolCrawler implements JobSourceCrawler {
	readonly source = JobSource.DOL;
	private readonly logger = new Logger(DolCrawler.name);
	private readonly config: Configuration["crawler"]["dol"];
	private readonly userAgent: string;

	constructor(configService: ConfigService) {
		this.config =
			configService.getOrThrow<Configuration["crawler"]["dol"]>("crawler.dol");
		this.userAgent = configService.getOrThrow<string>("crawler.userAgent");
	}

	async crawl(): Promise<CrawlResult> {
		const entries = await this.collectListing();

		// Zero cards across every page means the markup moved or the site is down — not "no
		// announcements". The page has never been empty, and a silently successful empty crawl
		// would report SUCCESS while quietly importing nothing.
		if (entries.length === 0) {
			throw new SourceUnavailableError(
				"DOL listing returned no announcements on any page"
			);
		}

		const jobs: NormalizedJob[] = [];
		const rejected: RejectedJob[] = [];

		for (const entry of entries) {
			// Most of this category is results and eligibility lists rather than openings.
			// Recording them as skips rather than dropping them silently is what makes the
			// filter reviewable: `skippedJobs` on the run row is the number to watch.
			if (!isRecruitmentAnnouncement(entry.title)) {
				rejected.push({
					externalId: entry.externalId,
					reason: "not a recruitment announcement",
				});
				continue;
			}

			try {
				jobs.push(normalizeDolJob(entry, await this.fetchAnnouncement(entry)));
			} catch (error) {
				const reason =
					error instanceof JobValidationError ||
					error instanceof SourceUnavailableError
						? error.message
						: "unexpected normalisation error";
				rejected.push({ externalId: entry.externalId, reason });
				this.logger.warn(`Skipped announcement ${entry.externalId}: ${reason}`);
			}
		}

		return { jobs, rejected, totalFound: entries.length };
	}

	/**
	 * DOL has no taxonomy endpoints — its announcements carry no ids into `reference_item`.
	 *
	 * Returning 0 rather than throwing is the contract: `CrawlerService` calls this before
	 * every crawl, and a source without taxonomies must not mark the run FAILED.
	 */
	async syncReference(): Promise<number> {
		return 0;
	}

	/**
	 * The first `listingPages` pages, newest first.
	 *
	 * Not the whole archive: the listing runs to 45 pages of mostly historical notices, and
	 * re-reading all of it every hour would be slow and rude for the handful of announcements
	 * that ever change. New announcements land on page 1.
	 *
	 * A page that fails after its retries ends the sweep instead of failing the crawl — page 1
	 * is the one that matters, and losing page 3 should not discard pages 1 and 2.
	 */
	private async collectListing(): Promise<DolListingEntry[]> {
		const entries = new Map<string, DolListingEntry>();

		for (let page = 1; page <= this.config.listingPages; page += 1) {
			let html: string;
			try {
				html = await this.fetchText(this.listingUrl(page));
			} catch (error) {
				if (page === 1) throw error;
				this.logger.warn(
					`Stopped after page ${page - 1}: ${error instanceof Error ? error.message : String(error)}`
				);
				break;
			}

			const pageEntries = parseDolListing(html);
			// An empty page past the first is the end of the archive, not a failure.
			if (pageEntries.length === 0) break;

			for (const entry of pageEntries) {
				// Pinned announcements repeat across pages; first sighting wins.
				if (!entries.has(entry.externalId)) entries.set(entry.externalId, entry);
			}
		}

		return [...entries.values()];
	}

	private listingUrl(page: number): string {
		const base = this.config.listingUrl.replace(/\/$/, "");
		return page === 1 ? `${base}/` : `${base}/?page=${page}`;
	}

	private async fetchAnnouncement(
		entry: DolListingEntry
	): Promise<ReturnType<typeof parseDolAnnouncement>> {
		return parseDolAnnouncement(await this.fetchText(entry.url));
	}

	/**
	 * One request, with a timeout and bounded retries — the same policy as the OCSC crawler.
	 *
	 * An empty 2xx body is a failure rather than an empty page: DOL sits behind a cache that
	 * has been seen to answer 200 with nothing during a deploy, and treating that as "no
	 * announcements" would delete nothing but import nothing either, silently.
	 */
	private async fetchText(url: string, attempt = 1): Promise<string> {
		const maxAttempts = 3;

		try {
			const response = await fetch(url, {
				headers: {
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "th,en;q=0.8",
					"User-Agent": this.userAgent,
				},
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});

			if (!response.ok) {
				throw new SourceUnavailableError(`GET ${url} returned ${response.status}`);
			}

			const body = await response.text();
			if (body.trim() === "") {
				throw new SourceUnavailableError(`GET ${url} returned an empty body`);
			}

			return body;
		} catch (error) {
			if (attempt >= maxAttempts) {
				throw error instanceof SourceUnavailableError
					? error
					: new SourceUnavailableError(
							`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`
						);
			}

			// Exponential backoff: 1s, 2s. A public service deserves better than a tight loop.
			const delayMs = 1000 * 2 ** (attempt - 1);
			this.logger.warn(
				`${error instanceof Error ? error.message : String(error)} — retrying in ${delayMs}ms (${attempt}/${maxAttempts})`
			);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			return this.fetchText(url, attempt + 1);
		}
	}
}

export { DOL_AGENCY };

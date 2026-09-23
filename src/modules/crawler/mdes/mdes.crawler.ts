import { Configuration } from "@/config/configuration";
import {
	CrawlResult,
	JobSourceCrawler,
	NormalizedJob,
	RejectedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	normalizeMdesJob,
	parseMdesAnnouncement,
	parseMdesListing,
} from "@/modules/crawler/mdes/mdes.parser";
import {
	MdesAnnouncementDetail,
	MdesListingEntry,
} from "@/modules/crawler/mdes/mdes.types";
import {
	JobValidationError,
	SourceUnavailableError,
} from "@/modules/crawler/normalization";
import { isRecruitmentAnnouncement } from "@/modules/crawler/recruitment-title";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม.
 *
 * MDES publishes no API, so this reads the same HTML a visitor sees: the "สมัครงาน" category
 * listing, then one announcement page per kept entry for its date and attachment. All the
 * source-specific parsing lives in `MdesParser`; this only fetches, filters and reports.
 */
@Injectable()
export class MdesCrawler implements JobSourceCrawler {
	readonly source = JobSource.MDES;
	private readonly logger = new Logger(MdesCrawler.name);
	private readonly config: Configuration["crawler"]["mdes"];
	private readonly userAgent: string;

	constructor(configService: ConfigService) {
		this.config =
			configService.getOrThrow<Configuration["crawler"]["mdes"]>("crawler.mdes");
		this.userAgent = configService.getOrThrow<string>("crawler.userAgent");
	}

	async crawl(): Promise<CrawlResult> {
		const entries = await this.collectListing();

		// Zero rows across every page means the markup moved or the site is down — not "no
		// announcements". A silently successful empty crawl would report SUCCESS while
		// importing nothing.
		if (entries.length === 0) {
			throw new SourceUnavailableError(
				"MDES listing returned no announcements on any page"
			);
		}

		const jobs: NormalizedJob[] = [];
		const rejected: RejectedJob[] = [];

		for (const entry of entries) {
			// The category mixes openings with results and eligibility lists. Recording the
			// rest as skips rather than dropping them silently is what makes the filter
			// reviewable: `skippedJobs` on the run row is the number to watch.
			if (!isRecruitmentAnnouncement(entry.title)) {
				rejected.push({
					externalId: entry.externalId,
					reason: "not a recruitment announcement",
				});
				continue;
			}

			try {
				jobs.push(normalizeMdesJob(entry, await this.fetchAnnouncement(entry)));
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
	 * MDES has no taxonomy endpoints. Returning 0 rather than throwing is the contract:
	 * `CrawlerService` calls this before every crawl, and a source without taxonomies must
	 * not mark the run FAILED.
	 */
	async syncReference(): Promise<number> {
		return 0;
	}

	/**
	 * The first `listingPages` pages, newest first.
	 *
	 * Not the whole archive: the listing runs to seven pages of mostly historical notices and
	 * re-reading all of it every hour would be slow and rude. New announcements land on page 1.
	 *
	 * A page that fails after its retries ends the sweep instead of failing the crawl — losing
	 * page 3 should not discard pages 1 and 2. Page 1 failing is still fatal.
	 */
	private async collectListing(): Promise<MdesListingEntry[]> {
		const entries = new Map<string, MdesListingEntry>();

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

			const pageEntries = parseMdesListing(html);
			// An empty page past the first is the end of the archive, not a failure.
			if (pageEntries.length === 0) break;

			for (const entry of pageEntries) {
				if (!entries.has(entry.externalId)) entries.set(entry.externalId, entry);
			}
		}

		return [...entries.values()];
	}

	private listingUrl(page: number): string {
		const base = this.config.listingUrl.replace(/\/$/, "");
		return page === 1 ? base : `${base}?page=${page}`;
	}

	private async fetchAnnouncement(
		entry: MdesListingEntry
	): Promise<MdesAnnouncementDetail> {
		return parseMdesAnnouncement(await this.fetchText(entry.url));
	}

	private async pause(): Promise<void> {
		if (this.config.requestDelayMs <= 0) return;
		await new Promise((resolve) => setTimeout(resolve, this.config.requestDelayMs));
	}

	/**
	 * One request, with a timeout and bounded retries — the same policy as the other sources,
	 * plus a pause before each one.
	 *
	 * MDES answers 403 to a burst and recovers on its own, so spacing the requests out is
	 * what actually keeps a crawl succeeding; retrying harder into the block would not. It is
	 * also simply the courteous way to read someone else's public website.
	 */
	private async fetchText(url: string, attempt = 1): Promise<string> {
		const maxAttempts = 3;
		await this.pause();

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

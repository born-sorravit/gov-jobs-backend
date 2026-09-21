import { Configuration } from "@/config/configuration";
import {
	CrawlResult,
	JobSourceCrawler,
	NormalizedJob,
	RejectedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	JobValidationError,
	normalizeOcscJob,
} from "@/modules/crawler/ocsc/ocsc.normalizer";
import { OcscRawJob, OcscRawReferenceRow } from "@/modules/crawler/ocsc/ocsc.types";
import {
	ReferenceItem,
	ReferenceKind,
} from "@/models/reference/entities/reference-item.entity";
import { ReferenceItemRepository } from "@/models/reference/reference-item.repository";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Which lookup endpoint feeds which taxonomy, and where its Thai label lives. */
const REFERENCE_ENDPOINTS: {
	kind: ReferenceKind;
	path: string;
	labelField: string;
}[] = [
	{ kind: ReferenceKind.PROVINCE, path: "/provinces", labelField: "province" },
	{
		kind: ReferenceKind.EDUCATION_LEVEL,
		path: "/educationlevels",
		labelField: "educationLevel",
	},
	{ kind: ReferenceKind.JOB_TYPE, path: "/jobtypes", labelField: "jobType" },
	{
		kind: ReferenceKind.JOB_CATEGORY,
		path: "/jobcategories",
		labelField: "jobCategory",
	},
	{ kind: ReferenceKind.JOB_LEVEL, path: "/joblevels", labelField: "jobLevel" },
	{
		kind: ReferenceKind.JOB_SELECTION,
		path: "/jobselections",
		labelField: "jobSelection",
	},
	{
		kind: ReferenceKind.JOB_CONDITION,
		path: "/jobconditions",
		labelField: "jobCondition",
	},
];

export class SourceUnavailableError extends Error {}

@Injectable()
export class OcscCrawler implements JobSourceCrawler {
	readonly source = JobSource.OCSC;
	private readonly logger = new Logger(OcscCrawler.name);
	private readonly config: Configuration["crawler"]["ocsc"];

	constructor(
		configService: ConfigService,
		private readonly referenceRepository: ReferenceItemRepository
	) {
		this.config =
			configService.getOrThrow<Configuration["crawler"]["ocsc"]>("crawler.ocsc");
	}

	async crawl(): Promise<CrawlResult> {
		const raw = await this.fetchJson<OcscRawJob[]>("/portal/jobs");

		if (!Array.isArray(raw)) {
			throw new SourceUnavailableError("GET /portal/jobs did not return an array");
		}

		// An empty list is treated as a broken source, not as "no announcements". The portal
		// has never returned fewer than ~50, and a silently successful zero-job crawl would
		// stop alerts firing while every dashboard and the scheduler reported SUCCESS.
		if (raw.length === 0) {
			throw new SourceUnavailableError("GET /portal/jobs returned an empty list");
		}

		const jobs: NormalizedJob[] = [];
		const rejected: RejectedJob[] = [];

		for (const entry of raw) {
			try {
				jobs.push(
					normalizeOcscJob(entry, { portalBaseUrl: this.config.portalBaseUrl })
				);
			} catch (error) {
				// One malformed announcement must never fail the run — record it and move on.
				const reason =
					error instanceof JobValidationError
						? error.message
						: "unexpected normalisation error";
				rejected.push({
					externalId: entry?.id != null ? String(entry.id) : null,
					reason,
				});
				this.logger.warn(
					`Skipped announcement ${entry?.id ?? "(no id)"}: ${reason}`
				);
			}
		}

		return { jobs, rejected, totalFound: raw.length };
	}

	/**
	 * Refreshes the Thai labels behind the taxonomy ids jobs store.
	 *
	 * `nameEn` is deliberately left out of the update: those translations are ours, written
	 * by the seed, and the source has no opinion on them. Including the column here would
	 * null out every translation on the first crawl.
	 */
	async syncReference(): Promise<number> {
		let total = 0;

		for (const endpoint of REFERENCE_ENDPOINTS) {
			const rows = await this.fetchJson<OcscRawReferenceRow[]>(endpoint.path);
			if (!Array.isArray(rows)) continue;

			const items = rows.map((row, index) => {
				const item = new ReferenceItem();
				item.source = JobSource.OCSC;
				item.kind = endpoint.kind;
				item.externalId = row.id;
				item.nameTh = String(row[endpoint.labelField] ?? "").trim();
				item.sortOrder = index;
				return item;
			});

			if (items.length === 0) continue;

			await this.referenceRepository.upsert(items, {
				conflictPaths: ["source", "kind", "externalId"],
				skipUpdateIfNoValuesChanged: true,
			});
			total += items.length;
		}

		return total;
	}

	/**
	 * One request, with a timeout and bounded retries on the failures that are worth
	 * retrying.
	 *
	 * An empty 2xx body is treated as a failure rather than as "no results": OCSC answers
	 * `204 No Content` for some malformed queries, and silently accepting that would mark a
	 * run SUCCESS with zero announcements — which reads as "every job closed at once".
	 */
	private async fetchJson<T>(path: string, attempt = 1): Promise<T> {
		const url = `${this.config.apiBaseUrl.replace(/\/$/, "")}${path}`;
		const maxAttempts = 3;

		try {
			const response = await fetch(url, {
				headers: { Accept: "application/json", "User-Agent": this.config.userAgent },
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});

			if (!response.ok) {
				throw new SourceUnavailableError(`GET ${path} returned ${response.status}`);
			}

			const body = await response.text();
			if (body.trim() === "") {
				throw new SourceUnavailableError(
					`GET ${path} returned ${response.status} with no body`
				);
			}

			try {
				return JSON.parse(body) as T;
			} catch {
				throw new SourceUnavailableError(
					`GET ${path} returned a body that is not JSON`
				);
			}
		} catch (error) {
			if (attempt >= maxAttempts) {
				throw error instanceof SourceUnavailableError
					? error
					: new SourceUnavailableError(
							`GET ${path} failed: ${error instanceof Error ? error.message : String(error)}`
						);
			}

			// Exponential backoff: 1s, 2s. The portal is a public service and a tight retry
			// loop against it would be rude as well as useless.
			const delayMs = 1000 * 2 ** (attempt - 1);
			this.logger.warn(
				`${error instanceof Error ? error.message : String(error)} — retrying in ${delayMs}ms (${attempt}/${maxAttempts})`
			);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			return this.fetchJson<T>(path, attempt + 1);
		}
	}
}

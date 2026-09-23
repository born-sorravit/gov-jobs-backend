import {
	NormalizedAttachment,
	NormalizedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	MdesAnnouncementDetail,
	MdesListingEntry,
} from "@/modules/crawler/mdes/mdes.types";
import {
	JobValidationError,
	computeContentHash,
	normalizeJobText,
} from "@/modules/crawler/normalization";
import { JobSource } from "@/shared/enums/job-source.enum";

/** กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม — the ministry every MDES announcement belongs to. */
export const MDES_AGENCY = "สำนักงานปลัดกระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม";
export const MDES_MINISTRY = "กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม";

const stripNonContent = (html: string): string =>
	html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "");

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	"#39": "'",
	apos: "'",
	nbsp: " ",
};

const decodeEntities = (value: string): string =>
	value
		.replace(
			/&(amp|lt|gt|quot|#39|apos|nbsp);/g,
			(_, name: string) => HTML_ENTITIES[name] ?? " "
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 10))
		);

const toText = (html: string): string =>
	decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();

/**
 * Every announcement on one listing page, in the order the page lists them.
 *
 * The `title` attribute is preferred over the link text, which the template truncates — and
 * MDES titles are long enough that it routinely does.
 *
 * `externalId` is the numeric prefix of the slug, never the slug itself: the rest of it is the
 * full Thai title, URL-encoded, and changes the moment somebody fixes a typo.
 */
export const parseMdesListing = (html: string): MdesListingEntry[] => {
	const content = stripNonContent(html);
	const entries: MdesListingEntry[] = [];
	const seen = new Set<string>();

	const pattern =
		/<a\b[^>]*?href="(https?:\/\/[^"]*?\/news\/detail\/(\d+)-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

	for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
		const [tag, url, externalId, inner] = match;

		if (seen.has(externalId)) continue;

		const titleAttr = /\btitle="([^"]+)"/i.exec(tag);
		const title = decodeEntities(titleAttr ? titleAttr[1] : toText(inner)).trim();
		if (title === "") continue;

		seen.add(externalId);
		entries.push({ externalId, title, url: decodeEntities(url) });
	}

	return entries;
};

/**
 * Thai `dd/mm/BE` as the announcement page stamps it, e.g. `14/09/2569`.
 *
 * Not `parseThaiDate`: that reads a *named* month, and this is all digits. The year is
 * treated as Buddhist era only when it is large enough to be one — subtracting 543 from a
 * year that was already Gregorian would move the announcement back five centuries.
 */
const parseSlashDate = (value: string): string | null => {
	const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(value);
	if (!match) return null;

	const day = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const rawYear = Number.parseInt(match[3], 10);
	const year = rawYear >= 2400 ? rawYear - 543 : rawYear;

	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	return date.toISOString().slice(0, 10);
};

export const parseMdesAnnouncement = (html: string): MdesAnnouncementDetail => {
	const content = stripNonContent(html);

	// MDES serves attachments from a download endpoint with no file extension, so these are
	// found by path rather than by suffix — a `\.pdf` match finds only the site's own policy
	// documents, which are in every page's footer.
	const attachmentUrls: string[] = [];
	for (const match of content.matchAll(
		/https?:\/\/[^\s"'<>\\]*?\/content\/download-detail\/\d+/gi
	)) {
		if (!attachmentUrls.includes(match[0])) attachmentUrls.push(match[0]);
	}

	const text = toText(content);
	const dateMatch = /วันที่\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(text);

	return {
		attachmentUrls,
		publishedOn: dateMatch ? parseSlashDate(dateMatch[1]) : null,
		body: null,
	};
};

/**
 * Maps one MDES announcement onto our schema.
 *
 * Pure and synchronous, testable against the captured fixtures with no network — the same
 * shape as `normalizeOcscJob` and `normalizeDolJob`. The taxonomy ids stay null: they are
 * OCSC's integer ids into `reference_item` and MDES publishes no equivalent.
 */
export const normalizeMdesJob = (
	entry: MdesListingEntry,
	detail: MdesAnnouncementDetail
): NormalizedJob => {
	if (entry.externalId.trim() === "") {
		throw new JobValidationError("missing announcement id");
	}
	if (entry.title.trim() === "") {
		throw new JobValidationError("missing title");
	}

	const attachments: NormalizedAttachment[] = detail.attachmentUrls.map(
		(url, index) => ({
			name: index === 0 ? "ประกาศรับสมัคร" : `เอกสารแนบ ${index + 1}`,
			url,
			type: "ANNOUNCEMENT_PDF",
		})
	);

	const withoutHash: Omit<NormalizedJob, "contentHash"> = {
		source: JobSource.MDES,
		externalId: entry.externalId,
		title: entry.title,
		agency: MDES_AGENCY,
		ministry: MDES_MINISTRY,
		agencyExternalId: null,
		agencySealUrl: null,
		jobCategoryId: null,
		jobCategoryOther: null,
		jobTypeId: null,
		jobTypeOther: null,
		jobLevelId: null,
		jobLevelOther: null,
		jobSelectionId: null,
		jobSelectionOther: null,
		jobConditionId: null,
		jobConditionOther: null,
		provinceIds: [],
		educationLevelIds: [],
		educationLevelOther: null,
		description: detail.body,
		educationRequirements: null,
		knowledge: null,
		skill: null,
		competency: null,
		criteria: null,
		salaryMin: null,
		salaryMax: null,
		positionAmount: null,
		// Inside the PDF, which this PR does not read. Left null rather than guessed:
		// `applicationEnd` drives the OPEN/CLOSED badge, and a wrong one would tell a reader a
		// closed announcement is still accepting applications.
		applicationStart: null,
		applicationEnd: null,
		examDate: null,
		interviewDate: null,
		publishedAt: detail.publishedOn
			? new Date(`${detail.publishedOn}T00:00:00+07:00`)
			: null,
		sourceUrl: entry.url,
		applyUrl: null,
		rawPayload: { listing: { ...entry }, detail: { ...detail } },
		attachments,
	};

	const normalized = normalizeJobText(withoutHash);
	return { ...normalized, contentHash: computeContentHash(normalized) };
};

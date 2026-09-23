import {
	NormalizedAttachment,
	NormalizedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	JobValidationError,
	computeContentHash,
	normalizeJobText,
} from "@/modules/crawler/normalization";
import {
	DolAnnouncementDetail,
	DolListingEntry,
} from "@/modules/crawler/dol/dol.types";
import { JobSource } from "@/shared/enums/job-source.enum";
import { parseThaiDate } from "@/shared/utils/date.util";

/** กรมที่ดิน — the agency every DOL announcement belongs to. */
export const DOL_AGENCY = "กรมที่ดิน";
export const DOL_MINISTRY = "กระทรวงมหาดไทย";

/** Everything a browser would not show: scripts, styles, and HTML comments. */
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

/** Tag-free, entity-decoded, single-spaced. */
const toText = (html: string): string =>
	decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();

/**
 * Splits the listing into one slice per announcement card.
 *
 * Slicing from each `card-template` to the next is used rather than matching a balanced
 * `<div>`: the markup nests four levels deep with no distinguishing close tag, and a regex
 * that tries to match the closing tag silently truncates the card at the first inner
 * `</div>`. Boundaries are all this needs — every field is found by its own pattern within
 * the slice.
 */
const splitCards = (html: string): string[] => {
	const starts: number[] = [];
	const pattern = /<div\b[^>]*class="[^"]*\bcard-template\b/gi;

	for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
		starts.push(match.index);
	}

	return starts.map((start, index) =>
		html.slice(start, starts[index + 1] ?? html.length)
	);
};

/**
 * Every announcement on one listing page, in the order the page lists them.
 *
 * Cards missing an id or a title are dropped rather than rejected: the same template renders
 * promo tiles and "related news" blocks, and reporting those as failures would make every
 * healthy run look broken.
 */
export const parseDolListing = (html: string): DolListingEntry[] => {
	const content = stripNonContent(html);
	const entries: DolListingEntry[] = [];
	const seen = new Set<string>();

	for (const card of splitCards(content)) {
		const link = /href="(https?:\/\/[^"]*?\/news-(\d+)\/?)"/i.exec(card);
		if (!link) continue;

		const [, url, externalId] = link;

		// The `title` attribute carries the full text; the visible heading is truncated with
		// an ellipsis on long announcements, and DOL's are routinely long.
		const titleAttr =
			/<h4\b[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*\btitle="([^"]*)"/i.exec(card);
		const title = titleAttr ? decodeEntities(titleAttr[1]).trim() : "";
		if (title === "") continue;

		// The same announcement can be pinned and listed again further down the page.
		if (seen.has(externalId)) continue;
		seen.add(externalId);

		const categoryMatch = /<div\b[^>]*class="category"[^>]*>([\s\S]*?)<\/div>/i.exec(
			card
		);
		const category = categoryMatch ? toText(categoryMatch[1]) || null : null;

		entries.push({
			externalId,
			title,
			url,
			category,
			publishedOn: parseThaiDate(toText(card)),
		});
	}

	return entries;
};

/** Absolute PDF links on the announcement page, de-duplicated, in document order. */
const parsePdfUrls = (content: string): string[] => {
	const urls: string[] = [];

	for (const match of content.matchAll(/https?:\/\/[^\s"'<>\\]+?\.pdf/gi)) {
		const url = match[0];
		// The theme ships a sample PDF inside its own asset tree, and the bundled pdf.js
		// viewer links the real file a second time through a `?file=` parameter.
		if (/\/(themes|assets)\//i.test(url)) continue;
		if (!urls.includes(url)) urls.push(url);
	}

	return urls;
};

export const parseDolAnnouncement = (html: string): DolAnnouncementDetail => {
	const content = stripNonContent(html);
	const bodyMatch =
		/<div\b[^>]*class="[^"]*\b(?:content-detail|news-detail|detail-content)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
			content
		);

	return {
		pdfUrls: parsePdfUrls(content),
		body: bodyMatch ? toText(bodyMatch[1]) || null : null,
	};
};

/**
 * Maps one DOL announcement onto our schema.
 *
 * Pure and synchronous, so the whole mapping is testable against the captured fixtures with
 * no network — the same shape as `normalizeOcscJob`.
 *
 * The taxonomy ids stay null throughout. They are OCSC's integer ids into `reference_item`
 * and DOL publishes no equivalent; nothing downstream requires them, and inventing a mapping
 * would put a guess where a user expects a fact.
 */
export const normalizeDolJob = (
	entry: DolListingEntry,
	detail: DolAnnouncementDetail
): NormalizedJob => {
	if (entry.externalId.trim() === "") {
		throw new JobValidationError("missing announcement id");
	}
	if (entry.title.trim() === "") {
		throw new JobValidationError("missing title");
	}

	const attachments: NormalizedAttachment[] = detail.pdfUrls.map((url, index) => ({
		// The first PDF on a DOL announcement page is the announcement itself; anything after
		// it is supporting material whose kind we cannot tell from the link alone.
		name: index === 0 ? "ประกาศรับสมัคร" : `เอกสารแนบ ${index + 1}`,
		url,
		type: "ANNOUNCEMENT_PDF",
	}));

	const withoutHash: Omit<NormalizedJob, "contentHash"> = {
		source: JobSource.DOL,
		externalId: entry.externalId,
		title: entry.title,
		agency: DOL_AGENCY,
		ministry: DOL_MINISTRY,
		agencyExternalId: null,
		agencySealUrl: null,
		jobCategoryId: null,
		jobCategoryOther: entry.category,
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
		// The dates live inside the PDF, which this PR does not read. Left null rather than
		// guessed: `applicationEnd` drives the OPEN/CLOSED badge, and a wrong one would tell
		// a user a closed announcement is still accepting applications.
		applicationStart: null,
		applicationEnd: null,
		examDate: null,
		interviewDate: null,
		publishedAt: entry.publishedOn
			? new Date(`${entry.publishedOn}T00:00:00+07:00`)
			: null,
		sourceUrl: entry.url,
		applyUrl: null,
		rawPayload: { listing: { ...entry }, detail: { ...detail } },
		attachments,
	};

	// Canonical Thai before hashing, so the hash describes the text that is stored and a
	// keyword matches whichever way the source happened to spell it.
	const normalized = normalizeJobText(withoutHash);
	return { ...normalized, contentHash: computeContentHash(normalized) };
};

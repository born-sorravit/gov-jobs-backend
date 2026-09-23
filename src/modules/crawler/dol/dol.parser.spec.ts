import {
	DOL_AGENCY,
	normalizeDolJob,
	parseDolAnnouncement,
	parseDolListing,
} from "@/modules/crawler/dol/dol.parser";
import { isRecruitmentAnnouncement } from "@/modules/crawler/recruitment-title";
import { JobValidationError } from "@/modules/crawler/normalization";
import { JobSource } from "@/shared/enums/job-source.enum";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The parser against pages captured from the live site, so the assertions are about markup
 * DOL actually serves rather than markup convenient to parse. Same arrangement as the OCSC
 * normaliser's fixture test: no network, no database, no crawler.
 */
const fixture = (name: string): string =>
	fs.readFileSync(path.join(__dirname, "../../../../test/fixtures", name), "utf8");

const LISTING = fixture("dol-examination.fixture.html");
const ANNOUNCEMENT = fixture("dol-announcement.fixture.html");

describe("parseDolListing", () => {
	const entries = parseDolListing(LISTING);

	it("recovers every announcement card on the page", () => {
		expect(entries).toHaveLength(10);
	});

	it("reads the id, title, url and Thai date off a card", () => {
		const entry = entries.find((e) => e.externalId === "1789697174");

		expect(entry).toMatchObject({
			externalId: "1789697174",
			title:
				"รับสมัครสอบแข่งขันเพื่อบรรจุและแต่งตั้งบุคคลเข้ารับราชการเป็นข้าราชการพลเรือนสามัญ สังกัดกรมที่ดิน",
			category: "การสอบ",
			// 18 ก.ย. 2569 — Buddhist era, converted.
			publishedOn: "2026-09-18",
		});
		expect(entry?.url).toContain("/news-1789697174/");
	});

	it("keeps the page's own order", () => {
		expect(entries.slice(0, 3).map((e) => e.externalId)).toEqual([
			"1790067068",
			"1789958686",
			"1789697174",
		]);
	});

	it("never returns the same announcement twice", () => {
		const ids = entries.map((e) => e.externalId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("gives every entry a usable id and title", () => {
		for (const entry of entries) {
			expect(entry.externalId).toMatch(/^\d+$/);
			expect(entry.title.length).toBeGreaterThan(0);
		}
	});

	it("returns nothing for markup with no cards, rather than throwing", () => {
		expect(parseDolListing("<html><body><p>ปิดปรับปรุง</p></body></html>")).toEqual([]);
	});
});

describe("parseDolAnnouncement", () => {
	const detail = parseDolAnnouncement(ANNOUNCEMENT);

	it("finds the announcement PDF", () => {
		expect(detail.pdfUrls).toContain(
			"https://www.dol.go.th/media/716929789247754240/2026/09/D8Pqm31VxG2T5ouRFdgeUc6r.pdf"
		);
	});

	/**
	 * The page links the same file twice — once directly and once through the bundled pdf.js
	 * viewer's `?file=` parameter — and ships a sample PDF in its theme. All three would
	 * become attachment rows.
	 */
	it("excludes theme assets and does not repeat a file", () => {
		expect(detail.pdfUrls).not.toContain(
			"https://www.dol.go.th/themes/dol_v1/sample/pdf1.pdf"
		);
		expect(new Set(detail.pdfUrls).size).toBe(detail.pdfUrls.length);
		for (const url of detail.pdfUrls) {
			expect(url).not.toContain("/themes/");
			expect(url).not.toContain("viewer.html");
		}
	});

	it("survives a page with no attachment", () => {
		expect(parseDolAnnouncement("<html><body>ไม่มีไฟล์</body></html>")).toEqual({
			pdfUrls: [],
			body: null,
		});
	});
});

describe("isRecruitmentAnnouncement", () => {
	it("accepts an open recruitment announcement", () => {
		expect(
			isRecruitmentAnnouncement(
				"รับสมัครสอบแข่งขันเพื่อบรรจุและแต่งตั้งบุคคลเข้ารับราชการเป็นข้าราชการพลเรือนสามัญ สังกัดกรมที่ดิน"
			)
		).toBe(true);
	});

	/**
	 * Internal moves are kept **on purpose**: an existing official applies to these exactly as
	 * an outsider applies to an open exam, and the line the filter draws is "can a reader
	 * apply to this right now?", not "is this open to the public?".
	 *
	 * Pinned here because it is the part of the list most likely to be narrowed by someone
	 * chasing a false positive, who would otherwise never learn it was deliberate.
	 */
	it.each([
		"ประกาศรับสมัครคัดเลือกข้าราชการเพื่อแต่งตั้ง (ย้าย) ให้ดำรงตำแหน่งประเภทวิชาการ ระดับชำนาญการ (หัวหน้าฝ่าย)",
		"ประกาศรับสมัครคัดเลือกข้าราชการพลเรือนสามัญเข้าสู่ระบบข้าราชการผู้มีผลสัมฤทธิ์สูง รุ่นที่ 22 ประจำปีงบประมาณ พ.ศ. 2569",
	])("accepts the internal move %s", (title) => {
		expect(isRecruitmentAnnouncement(title)).toBe(true);
	});

	/**
	 * The failure that matters. Each of these carries a position name, so a keyword alert
	 * would match it — and the user would be emailed about an exam result as though it were
	 * a job opening.
	 */
	it.each([
		"ให้ผู้สอบแข่งขันได้ฯ มารายงานตัวเพื่อบรรจุเข้ารับราชการในสังกัดกรมที่ดิน",
		"ประกาศรายชื่อผู้มีสิทธิเข้ารับการประเมินบุคคลเพื่อแต่งตั้งให้ดำรงตำแหน่งประเภทวิชาการ ระดับเชี่ยวชาญ กรมที่ดิน",
		"ประกาศรายชื่อผู้ผ่านการเลือกสรรเพื่อจัดจ้างเป็นพนักงานราชการทั่วไป (ส่วนกลาง)",
		"ประกาศการขึ้นบัญชีและการยกเลิกบัญชีผู้ได้รับการคัดเลือกในตำแหน่งนิติกรปฏิบัติการ ของกรมที่ดิน",
	])("rejects %s", (title) => {
		expect(isRecruitmentAnnouncement(title)).toBe(false);
	});

	it("passes exactly one announcement on the captured page", () => {
		const kept = parseDolListing(LISTING).filter((entry) =>
			isRecruitmentAnnouncement(entry.title)
		);

		expect(kept.map((entry) => entry.externalId)).toEqual(["1789697174"]);
	});
});

describe("normalizeDolJob", () => {
	const entry = parseDolListing(LISTING).find((e) => e.externalId === "1789697174");
	const job = normalizeDolJob(entry!, parseDolAnnouncement(ANNOUNCEMENT));

	it("produces a DOL job with the agency filled in", () => {
		expect(job).toMatchObject({
			source: JobSource.DOL,
			externalId: "1789697174",
			agency: DOL_AGENCY,
			ministry: "กระทรวงมหาดไทย",
		});
		expect(job.sourceUrl).toContain("/news-1789697174/");
	});

	/**
	 * The user's decision: `NormalizedJob` keeps its OCSC shape and a source without
	 * taxonomies leaves those fields empty rather than inventing ids.
	 */
	it("leaves the OCSC taxonomy ids empty", () => {
		expect(job).toMatchObject({
			jobTypeId: null,
			jobLevelId: null,
			jobCategoryId: null,
			agencyExternalId: null,
			provinceIds: [],
			educationLevelIds: [],
		});
	});

	/** The dates are inside the PDF, which this PR does not read. A guess would be worse. */
	it("leaves the application window null rather than guessing", () => {
		expect(job.applicationStart).toBeNull();
		expect(job.applicationEnd).toBeNull();
	});

	it("attaches the announcement PDF", () => {
		expect(job.attachments[0]).toMatchObject({
			name: "ประกาศรับสมัคร",
			type: "ANNOUNCEMENT_PDF",
		});
		expect(job.attachments[0].url).toMatch(/\.pdf$/);
	});

	it("dates the announcement in Bangkok time", () => {
		expect(job.publishedAt?.toISOString()).toBe("2026-09-17T17:00:00.000Z");
	});

	/** An unchanged announcement must hash identically, or every crawl re-notifies everyone. */
	it("is stable across identical inputs", () => {
		const again = normalizeDolJob(entry!, parseDolAnnouncement(ANNOUNCEMENT));
		expect(again.contentHash).toBe(job.contentHash);
	});

	it("changes the hash when the title changes", () => {
		const changed = normalizeDolJob(
			{ ...entry!, title: "รับสมัครสอบแข่งขัน ตำแหน่งอื่น" },
			parseDolAnnouncement(ANNOUNCEMENT)
		);
		expect(changed.contentHash).not.toBe(job.contentHash);
	});

	it("rejects an entry with no title", () => {
		expect(() =>
			normalizeDolJob({ ...entry!, title: "  " }, { pdfUrls: [], body: null })
		).toThrow(JobValidationError);
	});
});

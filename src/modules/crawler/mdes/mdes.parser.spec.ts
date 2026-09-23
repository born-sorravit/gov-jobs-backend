import {
	MDES_AGENCY,
	normalizeMdesJob,
	parseMdesAnnouncement,
	parseMdesListing,
} from "@/modules/crawler/mdes/mdes.parser";
import { JobValidationError } from "@/modules/crawler/normalization";
import { isRecruitmentAnnouncement } from "@/modules/crawler/recruitment-title";
import { JobSource } from "@/shared/enums/job-source.enum";
import * as fs from "node:fs";
import * as path from "node:path";

/** Pages captured from the live site, so the assertions are about markup MDES really serves. */
const fixture = (name: string): string =>
	fs.readFileSync(path.join(__dirname, "../../../../test/fixtures", name), "utf8");

const LISTING = fixture("mdes-jobs.fixture.html");
const ANNOUNCEMENT = fixture("mdes-announcement.fixture.html");

describe("parseMdesListing", () => {
	const entries = parseMdesListing(LISTING);

	it("recovers every announcement on the page", () => {
		expect(entries).toHaveLength(15);
	});

	/** The slug carries the whole Thai title and changes on any edit; the id does not. */
	it("takes the id from the numeric prefix, not the slug", () => {
		const entry = entries.find((e) => e.externalId === "11521");

		expect(entry?.externalId).toBe("11521");
		expect(entry?.url).toContain("/news/detail/11521-");
		for (const e of entries) {
			expect(e.externalId).toMatch(/^\d+$/);
		}
	});

	it("keeps the page's own order", () => {
		expect(entries.slice(0, 3).map((e) => e.externalId)).toEqual([
			"11548",
			"11521",
			"11520",
		]);
	});

	/** The visible link text is truncated by the template; the title attribute is not. */
	it("takes the full title, not the truncated link text", () => {
		const entry = entries.find((e) => e.externalId === "11521");

		expect(entry?.title).toContain("รับสมัครคัดเลือกข้าราชการพลเรือนสามัญ");
		expect(entry?.title).not.toContain("…");
		expect(entry?.title.length).toBeGreaterThan(100);
	});

	it("never returns the same announcement twice", () => {
		const ids = entries.map((e) => e.externalId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("returns nothing for markup with no rows, rather than throwing", () => {
		expect(parseMdesListing("<html><body><p>ปิดปรับปรุง</p></body></html>")).toEqual(
			[]
		);
	});
});

describe("parseMdesAnnouncement", () => {
	const detail = parseMdesAnnouncement(ANNOUNCEMENT);

	/**
	 * MDES serves attachments from a download endpoint with no file extension, so a `\.pdf`
	 * match — which is what the DOL parser uses — finds only the site-policy documents in
	 * every page's footer.
	 */
	it("finds the attachment behind the extensionless download URL", () => {
		expect(detail.attachmentUrls).toEqual([
			"https://mdes.go.th/content/download-detail/36420",
		]);
	});

	it("does not mistake the site's own policy PDFs for attachments", () => {
		for (const url of detail.attachmentUrls) {
			expect(url).not.toContain("website-policy");
			expect(url).not.toContain("website-security-policy");
		}
	});

	it("reads the Buddhist-era date off the page", () => {
		// 14/09/2569
		expect(detail.publishedOn).toBe("2026-09-14");
	});

	it("survives a page with neither date nor attachment", () => {
		expect(parseMdesAnnouncement("<html><body>ไม่มีไฟล์</body></html>")).toEqual({
			attachmentUrls: [],
			publishedOn: null,
			body: null,
		});
	});
});

describe("isRecruitmentAnnouncement, on MDES titles", () => {
	const entries = parseMdesListing(LISTING);

	it("keeps only the genuine openings on the captured page", () => {
		const kept = entries.filter((entry) => isRecruitmentAnnouncement(entry.title));

		expect(kept.map((e) => e.externalId)).toEqual(["11521", "11520", "11519"]);
		for (const entry of kept) {
			expect(entry.title).toContain("รับสมัครคัดเลือก");
		}
	});

	/**
	 * Each of these carries a position name, so a keyword alert would match it — and the
	 * reader would be emailed about a result as though it were a job opening.
	 */
	it("rejects the results and eligibility notices", () => {
		const skipped = entries.filter(
			(entry) => !isRecruitmentAnnouncement(entry.title)
		);

		expect(skipped).toHaveLength(12);
		expect(skipped.some((e) => e.title.includes("การขึ้นบัญชีและการยกเลิกบัญชี"))).toBe(
			true
		);
		expect(skipped.some((e) => e.title.includes("รายชื่อผู้มีสิทธิ"))).toBe(true);
	});

	/**
	 * MDES writes `ำ` both ways on this one page. The predicate normalises before comparing,
	 * so a title is judged on what it says rather than on how it happened to be encoded.
	 */
	it("is not fooled by the two spellings of ำ", () => {
		const decomposed = "ประกาศรับสมัครคัดเลือกข้าราชการเพื่อแต่งตั้งให้ดํารงตําแหน่ง";
		expect(isRecruitmentAnnouncement(decomposed)).toBe(true);
	});
});

describe("normalizeMdesJob", () => {
	const entry = parseMdesListing(LISTING).find((e) => e.externalId === "11521");
	const job = normalizeMdesJob(entry!, parseMdesAnnouncement(ANNOUNCEMENT));

	it("produces an MDES job with the agency filled in", () => {
		expect(job).toMatchObject({
			source: JobSource.MDES,
			externalId: "11521",
			agency: MDES_AGENCY,
			ministry: "กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม",
		});
		expect(job.sourceUrl).toContain("/news/detail/11521-");
	});

	/** The stored title must be canonical, or a user's keyword silently fails to match it. */
	it("stores canonical Thai, whichever way the source spelled it", () => {
		expect(job.title).not.toContain("ํา");
		expect(job.title).toContain("ดำรงตำแหน่ง");
	});

	it("leaves the OCSC taxonomy ids empty", () => {
		expect(job).toMatchObject({
			jobTypeId: null,
			jobLevelId: null,
			jobCategoryId: null,
			provinceIds: [],
			educationLevelIds: [],
		});
	});

	it("leaves the application window null rather than guessing", () => {
		expect(job.applicationStart).toBeNull();
		expect(job.applicationEnd).toBeNull();
	});

	it("attaches the announcement document", () => {
		expect(job.attachments).toEqual([
			{
				name: "ประกาศรับสมัคร",
				url: "https://mdes.go.th/content/download-detail/36420",
				type: "ANNOUNCEMENT_PDF",
			},
		]);
	});

	it("dates the announcement in Bangkok time", () => {
		expect(job.publishedAt?.toISOString()).toBe("2026-09-13T17:00:00.000Z");
	});

	it("is stable across identical inputs", () => {
		const again = normalizeMdesJob(entry!, parseMdesAnnouncement(ANNOUNCEMENT));
		expect(again.contentHash).toBe(job.contentHash);
	});

	/**
	 * The two spellings are the same announcement, so they must hash the same — otherwise
	 * every crawl would see the title "change" and re-notify everyone.
	 */
	it("hashes the two spellings of ำ identically", () => {
		const decomposed = normalizeMdesJob(
			{ ...entry!, title: entry!.title.replace(/ำ/g, "ํา") },
			parseMdesAnnouncement(ANNOUNCEMENT)
		);
		expect(decomposed.contentHash).toBe(job.contentHash);
	});

	it("rejects an entry with no title", () => {
		expect(() =>
			normalizeMdesJob(
				{ ...entry!, title: "  " },
				{ attachmentUrls: [], publishedOn: null, body: null }
			)
		).toThrow(JobValidationError);
	});
});

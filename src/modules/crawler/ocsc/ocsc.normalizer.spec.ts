import {
	JobValidationError,
	computeContentHash,
} from "@/modules/crawler/normalization";
import { normalizeOcscJob } from "@/modules/crawler/ocsc/ocsc.normalizer";
import { OcscRawJob } from "@/modules/crawler/ocsc/ocsc.types";
import { JobSource } from "@/shared/enums/job-source.enum";
import * as fs from "node:fs";
import * as path from "node:path";

const OPTIONS = { portalBaseUrl: "https://job.ocsc.go.th/portal" };

const FIXTURE: OcscRawJob[] = JSON.parse(
	fs.readFileSync(
		path.join(__dirname, "../../../../test/fixtures/ocsc-jobs.fixture.json"),
		"utf8"
	)
);

const byCategory = (categoryId: number): OcscRawJob =>
	FIXTURE.find((job) => job.jobCategoryId === categoryId) as OcscRawJob;

describe("normalizeOcscJob", () => {
	it("normalises every announcement in the captured snapshot", () => {
		const normalised = FIXTURE.map((raw) => normalizeOcscJob(raw, OPTIONS));

		expect(normalised).toHaveLength(51);
		for (const job of normalised) {
			expect(job.source).toBe(JobSource.OCSC);
			expect(job.externalId).toMatch(/^\d+$/);
			expect(job.title.length).toBeGreaterThan(0);
			expect(job.agency.length).toBeGreaterThan(0);
			expect(job.contentHash).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it("points sourceUrl at the human page, never the jobapi host", () => {
		const job = normalizeOcscJob(FIXTURE[0], OPTIONS);

		expect(job.sourceUrl).toBe(
			`https://job.ocsc.go.th/portal/jobs/${FIXTURE[0].id}`
		);
		expect(job.sourceUrl).not.toContain("jobapi");
	});

	it("keeps the application site separate from the announcement page", () => {
		const raw = FIXTURE.find((job) => job.url) as OcscRawJob;
		const job = normalizeOcscJob(raw, OPTIONS);

		expect(job.applyUrl).toBe(raw.url);
		expect(job.applyUrl).not.toBe(job.sourceUrl);
	});

	it("turns the announcement PDF into an attachment", () => {
		const raw = FIXTURE.find((job) => job.fileName) as OcscRawJob;
		const job = normalizeOcscJob(raw, OPTIONS);

		expect(job.attachments).toHaveLength(1);
		expect(job.attachments[0]).toMatchObject({
			url: raw.fileName,
			type: "ANNOUNCEMENT_PDF",
		});
	});

	describe("the two requirement blocks", () => {
		it("reads civilJob* for a civil-servant announcement", () => {
			const raw = byCategory(1);
			const job = normalizeOcscJob(raw, OPTIONS);

			expect(job.educationRequirements).toBe(raw.civilJobEducation?.trim());
			expect(job.educationRequirements).not.toBeNull();
		});

		it("reads employeeJob* for a government-employee announcement", () => {
			const raw = byCategory(2);
			const job = normalizeOcscJob(raw, OPTIONS);

			expect(job.educationRequirements).toBe(raw.employeeJobSpecification?.trim());
			expect(job.educationRequirements).not.toBeNull();
		});

		it("fills educationRequirements for every announcement in the snapshot", () => {
			// Both blocks are optional in the payload but exactly one is always populated;
			// a null here would mean the category split changed upstream.
			const missing = FIXTURE.map((raw) => normalizeOcscJob(raw, OPTIONS)).filter(
				(job) => job.educationRequirements === null
			);
			expect(missing).toEqual([]);
		});

		it("joins the two halves of a split employee field", () => {
			const job = normalizeOcscJob(
				{
					id: 1,
					position: "ตำแหน่ง",
					department: "หน่วยงาน",
					employeeJobKnowledge1: "ความรู้ส่วนที่หนึ่ง",
					employeeJobKnowledge2: "ความรู้ส่วนที่สอง",
				},
				OPTIONS
			);

			expect(job.knowledge).toBe("ความรู้ส่วนที่หนึ่ง\nความรู้ส่วนที่สอง");
		});

		it("drops a half that exactly repeats the one before it", () => {
			// OCSC fills both halves with the same sentence on 34 of the 34 announcements that
			// use them, so joining blindly prints every requirement twice.
			const job = normalizeOcscJob(
				{
					id: 1,
					position: "ตำแหน่ง",
					department: "หน่วยงาน",
					employeeJobSkill1: "รายละเอียดตามประกาศรับสมัคร",
					employeeJobSkill2: "รายละเอียดตามประกาศรับสมัคร",
				},
				OPTIONS
			);

			expect(job.skill).toBe("รายละเอียดตามประกาศรับสมัคร");
		});

		it("keeps both halves when they genuinely differ, in source order", () => {
			const job = normalizeOcscJob(
				{
					id: 1,
					position: "ตำแหน่ง",
					department: "หน่วยงาน",
					employeeJobCompetency1: "สมรรถนะหลัก",
					employeeJobCompetency2: "สมรรถนะเฉพาะ",
				},
				OPTIONS
			);

			expect(job.competency).toBe("สมรรถนะหลัก\nสมรรถนะเฉพาะ");
		});

		it("drops an empty half instead of leaving a dangling newline", () => {
			const job = normalizeOcscJob(
				{
					id: 1,
					position: "ตำแหน่ง",
					department: "หน่วยงาน",
					employeeJobSkill1: "ทักษะ",
					employeeJobSkill2: "  ",
				},
				OPTIONS
			);

			expect(job.skill).toBe("ทักษะ");
		});
	});

	describe("validation", () => {
		it.each([
			["missing id", { position: "ตำแหน่ง", department: "หน่วยงาน" }],
			["missing position", { id: 1, department: "หน่วยงาน" }],
			["missing department", { id: 1, position: "ตำแหน่ง" }],
			["blank position", { id: 1, position: "   ", department: "หน่วยงาน" }],
		])("rejects an announcement with %s", (_label, raw) => {
			expect(() => normalizeOcscJob(raw as OcscRawJob, OPTIONS)).toThrow(
				JobValidationError
			);
		});
	});

	describe("normalisation details", () => {
		it("sorts id arrays so member order cannot change the hash", () => {
			const job = normalizeOcscJob(
				{
					id: 1,
					position: "ตำแหน่ง",
					department: "หน่วยงาน",
					provinceIds: [47, 2, 14],
					educationLevelIds: [9, 8],
				},
				OPTIONS
			);

			expect(job.provinceIds).toEqual([2, 14, 47]);
			expect(job.educationLevelIds).toEqual([8, 9]);
		});

		it("treats an absent province array as nationwide, not as an error", () => {
			const job = normalizeOcscJob(
				{ id: 1, position: "ก", department: "ข" },
				OPTIONS
			);
			expect(job.provinceIds).toEqual([]);
		});

		it("reads the naive publish timestamp as Bangkok wall-clock time", () => {
			const job = normalizeOcscJob(
				{ id: 1, position: "ก", department: "ข", createDate: "2026-09-21T15:06:09" },
				OPTIONS
			);
			expect(job.publishedAt?.toISOString()).toBe("2026-09-21T08:06:09.000Z");
		});

		it("collapses empty strings to null rather than storing them", () => {
			const job = normalizeOcscJob(
				{ id: 1, position: "ก", department: "ข", ministry: "   ", jobTypeOther: "" },
				OPTIONS
			);
			expect(job.ministry).toBeNull();
			expect(job.jobTypeOther).toBeNull();
		});
	});
});

describe("computeContentHash", () => {
	const base = normalizeOcscJob(FIXTURE[0], OPTIONS);

	it("is stable across runs for identical input", () => {
		expect(normalizeOcscJob(FIXTURE[0], OPTIONS).contentHash).toBe(base.contentHash);
	});

	it("does not depend on the order fields were assigned in", () => {
		// The whole value of the hash is that it only moves when the announcement moves. If
		// it keyed off object insertion order, reordering a line in the normaliser would
		// report all 51 announcements as changed and re-run matching for every one.
		const { contentHash: _ignored, ...fields } = base;
		const reversed = Object.fromEntries(
			Object.entries(fields).reverse()
		) as unknown as typeof fields;

		expect(computeContentHash(reversed)).toBe(base.contentHash);
	});

	it("ignores the view counters, which change on every request", () => {
		const withViews = normalizeOcscJob(
			{ ...FIXTURE[0], webView: 999_999, mobileView: 12_345, webShare: 7 },
			OPTIONS
		);

		expect(withViews.contentHash).toBe(base.contentHash);
	});

	it("changes when the deadline moves", () => {
		const moved = normalizeOcscJob(
			{ ...FIXTURE[0], applicationEnd: "2099-01-01" },
			OPTIONS
		);
		expect(moved.contentHash).not.toBe(base.contentHash);
	});

	it("changes when the salary moves", () => {
		const moved = normalizeOcscJob({ ...FIXTURE[0], salaryMax: 999_999 }, OPTIONS);
		expect(moved.contentHash).not.toBe(base.contentHash);
	});

	it("is distinct for every announcement in the snapshot", () => {
		const hashes = FIXTURE.map((raw) => normalizeOcscJob(raw, OPTIONS).contentHash);
		expect(new Set(hashes).size).toBe(hashes.length);
	});
});

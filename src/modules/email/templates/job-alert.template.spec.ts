import { Job } from "@/models/jobs/entities/job.entity";
import {
	ReferenceItem,
	ReferenceKind,
} from "@/models/reference/entities/reference-item.entity";
import {
	JobAlertEmailInput,
	buildHtml,
	buildSubject,
	buildText,
} from "@/modules/email/templates/job-alert.template";
import { JobSource } from "@/shared/enums/job-source.enum";

const label = (
	kind: ReferenceKind,
	id: number,
	th: string,
	en: string
): ReferenceItem => {
	const item = new ReferenceItem();
	Object.assign(item, {
		source: JobSource.OCSC,
		kind,
		externalId: id,
		nameTh: th,
		nameEn: en,
	});
	return item;
};

const LABELS = new Map<string, ReferenceItem>([
	["PROVINCE:2", label(ReferenceKind.PROVINCE, 2, "กรุงเทพมหานคร", "Bangkok")],
	[
		"EDUCATION_LEVEL:8",
		label(ReferenceKind.EDUCATION_LEVEL, 8, "ป.ตรี", "Bachelor's Degree"),
	],
	["JOB_TYPE:2", label(ReferenceKind.JOB_TYPE, 2, "วิชาการ", "Academic")],
]);

const makeJob = (overrides: Partial<Job> = {}): Job =>
	Object.assign(new Job(), {
		id: "11111111-1111-4111-8111-111111111111",
		source: JobSource.OCSC,
		externalId: "11226",
		title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
		agency: "สำนักงานปลัดกระทรวง",
		ministry: "กระทรวงดิจิทัลเพื่อเศรษฐกิจและสังคม",
		jobTypeId: 2,
		provinceIds: [2],
		educationLevelIds: [8],
		salaryMin: 16_500,
		salaryMax: 18_150,
		applicationStart: "2026-10-01",
		applicationEnd: "2026-10-26",
		sourceUrl: "https://job.ocsc.go.th/portal/jobs/11226",
		...overrides,
	}) as Job;

const input = (overrides: Partial<JobAlertEmailInput> = {}): JobAlertEmailInput => ({
	locale: "th",
	alertName: "งานไอที",
	jobs: [makeJob()],
	labels: LABELS,
	webUrl: "https://example.test",
	manageUrl: "https://example.test/alerts",
	unsubscribeUrl: "https://api.example.test/api/v1/alerts/unsubscribe?token=tok-123",
	...overrides,
});

describe("job alert email", () => {
	describe("subject", () => {
		it("leads with the position title, not the alert name", () => {
			// It is the one line that survives truncation in a notification shade, and the
			// position is what the reader is deciding about.
			const subject = buildSubject(input());
			expect(subject.startsWith("นักวิชาการคอมพิวเตอร์ปฏิบัติการ")).toBe(true);
			expect(subject).not.toContain("งานไอที");
		});

		it("counts the rest when there is more than one", () => {
			const subject = buildSubject(
				input({ jobs: [makeJob(), makeJob({ id: "b" }), makeJob({ id: "c" })] })
			);
			expect(subject).toContain("อีก 2 ตำแหน่ง");
		});

		it("switches language with the locale", () => {
			expect(buildSubject(input({ locale: "en" }))).toContain(
				"a new matching announcement"
			);
		});
	});

	describe("body", () => {
		it("carries every field the spec requires", () => {
			const text = buildText(input());

			expect(text).toContain("นักวิชาการคอมพิวเตอร์ปฏิบัติการ"); // title
			expect(text).toContain("สำนักงานปลัดกระทรวง"); // agency
			expect(text).toContain("วิชาการ"); // job type
			expect(text).toContain("ป.ตรี"); // education
			expect(text).toContain("กรุงเทพมหานคร"); // province
			expect(text).toContain("2569"); // application period, Buddhist era
			expect(text).toContain("16,500–18,150"); // salary
			expect(text).toContain("https://job.ocsc.go.th/portal/jobs/11226"); // source URL
		});

		it("always links the original announcement", () => {
			// Requirement 7: a reader must always be able to verify the source.
			for (const body of [buildText(input()), buildHtml(input())]) {
				expect(body).toContain("https://job.ocsc.go.th/portal/jobs/11226");
			}
		});

		it("labels an announcement with no province as nationwide", () => {
			const text = buildText(input({ jobs: [makeJob({ provinceIds: [] })] }));
			expect(text).toContain("ทั่วประเทศ");
		});

		it("omits salary when the source published none", () => {
			const text = buildText(
				input({ jobs: [makeJob({ salaryMin: null, salaryMax: null })] })
			);
			expect(text).not.toContain("เงินเดือน");
		});

		it("renders Thai dates in the Buddhist era, English ones in Gregorian", () => {
			expect(buildText(input())).toContain("2569");
			expect(buildText(input({ locale: "en" }))).toContain("2026");
		});
	});

	describe("html", () => {
		it("declares the content language so clients pick the right font and line breaking", () => {
			expect(buildHtml(input())).toContain('<html lang="th">');
			expect(buildHtml(input({ locale: "en" }))).toContain('<html lang="en">');
		});

		it("names Thai-capable faces first — no email client ships the site's font", () => {
			expect(buildHtml(input())).toMatch(/font-family:'Noto Sans Thai','Sarabun'/);
		});

		it("escapes markup in agency-authored text", () => {
			const html = buildHtml(
				input({ jobs: [makeJob({ title: '<script>alert("x")</script>' })] })
			);
			expect(html).not.toContain("<script>");
			expect(html).toContain("&lt;script&gt;");
		});
	});
});

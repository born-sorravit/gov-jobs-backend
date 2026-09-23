import { Job } from "@/models/jobs/entities/job.entity";
import { buildHaystack } from "@/modules/job-alerts/alert-matching.service";
import { ExtractionStatus } from "@/shared/enums/extraction.enum";

const job = (over: Partial<Job> = {}): Job =>
	({
		title: "นักวิชาการคอมพิวเตอร์ปฏิบัติการ",
		agency: "กรมที่ดิน",
		description: null,
		attachments: [],
		...over,
	}) as Job;

const attachment = (
	extractedText: string | null,
	extractionStatus = ExtractionStatus.COMPLETED
) => ({ extractedText, extractionStatus }) as Job["attachments"][number];

describe("buildHaystack", () => {
	it("always covers the title and the agency", () => {
		const haystack = buildHaystack(job(), false);

		expect(haystack).toContain("นักวิชาการคอมพิวเตอร์ปฏิบัติการ");
		expect(haystack).toContain("กรมที่ดิน");
	});

	it("leaves document text out unless asked for it", () => {
		const withDocs = job({
			attachments: [attachment("เนื้อหาในเอกสารประกาศ")],
		});

		expect(buildHaystack(withDocs, false)).not.toContain("เนื้อหาในเอกสารประกาศ");
		expect(buildHaystack(withDocs, true)).toContain("เนื้อหาในเอกสารประกาศ");
	});

	/**
	 * An `INSUFFICIENT_TEXT` row holds a few characters of header junk, kept as the evidence
	 * for that verdict. Feeding it to matching is noise with no signal in it.
	 */
	it("uses only documents that were read successfully", () => {
		const mixed = job({
			attachments: [
				attachment("ข้อความที่อ่านได้", ExtractionStatus.COMPLETED),
				attachment("เศษ", ExtractionStatus.INSUFFICIENT_TEXT),
				attachment(null, ExtractionStatus.FAILED),
			],
		});

		const haystack = buildHaystack(mixed, true);

		expect(haystack).toContain("ข้อความที่อ่านได้");
		expect(haystack).not.toContain("เศษ");
	});

	it("includes the description, which some sources fill and others do not", () => {
		expect(buildHaystack(job({ description: "รายละเอียดงาน" }), false)).toContain(
			"รายละเอียดงาน"
		);
	});

	it("survives a job loaded without its attachments", () => {
		const bare = job({ attachments: undefined as never });

		expect(() => buildHaystack(bare, true)).not.toThrow();
		expect(buildHaystack(bare, true)).toContain("กรมที่ดิน");
	});

	it("puts each part on its own line, so two fields cannot form a phrase together", () => {
		// "…ปฏิบัติการ" + "กรม…" must not read as "ปฏิบัติการกรม".
		expect(buildHaystack(job(), false)).toBe("นักวิชาการคอมพิวเตอร์ปฏิบัติการ\nกรมที่ดิน");
	});
});

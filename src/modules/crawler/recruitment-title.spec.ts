import { isRecruitmentAnnouncement } from "@/modules/crawler/recruitment-title";

/**
 * The shared predicate's own contract.
 *
 * Whether it makes the right call on any given portal's titles is asserted in that portal's
 * parser spec, against captured pages. What belongs here is the behaviour that is not about
 * any portal — above all the normalisation, which is the subtlest thing the module does and
 * would otherwise be covered only as a side note in one source's tests.
 */
describe("isRecruitmentAnnouncement", () => {
	it.each([
		"รับสมัครสอบแข่งขันเพื่อบรรจุและแต่งตั้งบุคคลเข้ารับราชการ",
		"ประกาศรับสมัครคัดเลือกข้าราชการเพื่อแต่งตั้ง (ย้าย) ให้ดำรงตำแหน่ง",
		"รับโอนข้าราชการพลเรือนสามัญ",
		"รับสมัครบุคคลเพื่อเลือกสรรเป็นพนักงานราชการทั่วไป",
	])("accepts %s", (title) => {
		expect(isRecruitmentAnnouncement(title)).toBe(true);
	});

	it.each([
		"ประกาศรายชื่อผู้มีสิทธิเข้ารับการประเมินบุคคล",
		"ให้ผู้สอบแข่งขันได้ฯ มารายงานตัวเพื่อบรรจุเข้ารับราชการ",
		"ประกาศการขึ้นบัญชีและการยกเลิกบัญชีผู้สอบแข่งขันได้",
		"ประกาศหลักเกณฑ์ วิธีการ และเกณฑ์การตัดสิน การประเมินบุคคล",
	])("rejects %s", (title) => {
		expect(isRecruitmentAnnouncement(title)).toBe(false);
	});

	/**
	 * The property that is not about any portal: `ำ` has two spellings that look identical,
	 * and a title must be judged on what it says rather than on how it was encoded. MDES
	 * publishes both spellings, so this is load-bearing, not hypothetical.
	 */
	it("judges a title the same whichever way ำ is written", () => {
		const canonical = "ประกาศรับสมัครคัดเลือกข้าราชการเพื่อแต่งตั้งให้ดำรงตำแหน่ง";
		const decomposed = canonical.replace(/ำ/g, "ํา");

		expect(decomposed).not.toBe(canonical);
		expect(isRecruitmentAnnouncement(decomposed)).toBe(
			isRecruitmentAnnouncement(canonical)
		);
		expect(isRecruitmentAnnouncement(decomposed)).toBe(true);
	});

	it("matches anywhere in the title, not only at the start", () => {
		expect(
			isRecruitmentAnnouncement("ประกาศกรมที่ดิน เรื่อง รับสมัครสอบแข่งขัน ประจำปี 2569")
		).toBe(true);
	});

	it("returns false for an empty title rather than throwing", () => {
		expect(isRecruitmentAnnouncement("")).toBe(false);
	});
});

import {
	normalizeThaiText,
	normalizeThaiTextOrNull,
} from "@/shared/utils/thai-text.util";

const SARA_AM = "ำ";
const NIKHAHIT = "ํ";
const SARA_AA = "า";
/** `ดำรงตำแหน่ง` spelled with the two-codepoint vowel, exactly as MDES publishes it. */
const DECOMPOSED = `ด${NIKHAHIT}${SARA_AA}รงต${NIKHAHIT}${SARA_AA}แหน่ง`;

describe("normalizeThaiText", () => {
	/**
	 * The bug this exists for: `ำ` has no canonical decomposition, so every `normalize()`
	 * form leaves the two-codepoint spelling untouched and the two strings stay unequal.
	 */
	it("is not something String.normalize can do", () => {
		for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const) {
			expect(DECOMPOSED.normalize(form)).not.toBe("ดำรงตำแหน่ง");
		}
		expect(normalizeThaiText(DECOMPOSED)).toBe("ดำรงตำแหน่ง");
	});

	it("composes the two-codepoint vowel", () => {
		expect(normalizeThaiText(`ท${NIKHAHIT}${SARA_AA}`)).toBe(`ท${SARA_AM}`);
	});

	it("leaves text that is already canonical alone", () => {
		const canonical = "รับสมัครสอบแข่งขันเพื่อบรรจุและแต่งตั้งบุคคล";
		expect(normalizeThaiText(canonical)).toBe(canonical);
	});

	/** A tone mark caught between the halves must end up before the composed vowel. */
	it("keeps a tone mark, in the order Thai is normally stored", () => {
		expect(normalizeThaiText(`ก${NIKHAHIT}่${SARA_AA}`)).toBe(`ก่${SARA_AM}`);
	});

	it("makes the two spellings compare equal, which is the whole point", () => {
		expect(normalizeThaiText(DECOMPOSED)).toBe(normalizeThaiText("ดำรงตำแหน่ง"));
	});

	it("does not touch a lone nikhahit or a lone sara aa", () => {
		// `สํ` without a following `า` is a real sequence and must survive.
		expect(normalizeThaiText(`ส${NIKHAHIT}`)).toBe(`ส${NIKHAHIT}`);
		expect(normalizeThaiText(`ก${SARA_AA}`)).toBe(`ก${SARA_AA}`);
	});

	it("leaves non-Thai text untouched", () => {
		expect(normalizeThaiText("Computer Technical Officer")).toBe(
			"Computer Technical Officer"
		);
		expect(normalizeThaiText("")).toBe("");
	});
});

/**
 * Thai PDFs are produced with fonts that put tone marks at Private Use Area codepoints so
 * the glyph sits at the right height. The extractor reads what the font says, so the text
 * looks correct and matches nothing — measured at 11,435 such characters across 11 of the 12
 * announcements extracted so far.
 */
describe("normalizeThaiText, on PDF Private Use Area marks", () => {
	it("restores a tone mark written at U+F70A", () => {
		expect(normalizeThaiText("ตำแหน\uF70Aง")).toBe("ตำแหน่ง");
	});

	it.each([
		["\uF70A", "\u0E48", "MAI EK"],
		["\uF70B", "\u0E49", "MAI THO"],
		["\uF70C", "\u0E4A", "MAI TRI"],
		["\uF70D", "\u0E4B", "MAI CHATTAWA"],
		["\uF70E", "\u0E4C", "THANTHAKHAT"],
		["\uF710", "\u0E31", "MAI HAN AKAT"],
		["\uF712", "\u0E35", "SARA II"],
		["\uF718", "\u0E38", "SARA U"],
	])("maps %s to %s (%s)", (pua, expected) => {
		expect(normalizeThaiText(`ก${pua}`)).toBe(`ก${expected}`);
	});

	it("makes a real extracted phrase match what a user would type", () => {
		const asExtracted = "ผู\uF70Bสมัครต\uF70Aองได\uF70Bรับการคัดเลือก";
		expect(normalizeThaiText(asExtracted)).toBe("ผู้สมัครต่องได้รับการคัดเลือก");
		expect(normalizeThaiText(asExtracted)).toContain("ได้");
	});

	/** Outside the table's block: left alone rather than mangled into something plausible. */
	it("leaves unrelated Private Use Area characters alone", () => {
		expect(normalizeThaiText("\uE000\uF8FF")).toBe("\uE000\uF8FF");
	});

	it("is a no-op for text that never came from a PDF", () => {
		const html = "รับสมัครสอบแข่งขันเพื่อบรรจุและแต่งตั้งบุคคล";
		expect(normalizeThaiText(html)).toBe(html);
	});
});

describe("normalizeThaiTextOrNull", () => {
	it("normalizes a value", () => {
		expect(normalizeThaiTextOrNull(DECOMPOSED)).toBe("ดำรงตำแหน่ง");
	});

	it.each([
		[null, null],
		[undefined, null],
		["", null],
	])("maps %p to %p", (input, expected) => {
		expect(normalizeThaiTextOrNull(input)).toBe(expected);
	});
});

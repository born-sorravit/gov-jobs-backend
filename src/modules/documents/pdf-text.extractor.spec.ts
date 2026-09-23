import {
	PdfTextExtractor,
	PdfUnreadableError,
} from "@/modules/documents/pdf-text.extractor";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Against real announcement PDFs, because the property that matters — whether a document has
 * a usable text layer — cannot be synthesised convincingly. One of these is a born-digital
 * announcement and the other is a scan, which is the branch the whole pipeline turns on.
 */
const fixture = (name: string): Uint8Array =>
	new Uint8Array(
		fs.readFileSync(path.join(__dirname, "../../../test/fixtures", name))
	);

describe("PdfTextExtractor", () => {
	const extractor = new PdfTextExtractor();

	describe("a born-digital announcement", () => {
		it("reads the text layer", async () => {
			const result = await extractor.extract(
				fixture("mdes-announcement.fixture.pdf")
			);

			expect(result.pageCount).toBe(15);
			expect(result.text.length).toBeGreaterThan(20_000);
			expect(result.text).toContain("รับสมัครคัดเลือกข้าราชการพลเรือนสามัญ");
		});

		/**
		 * The bug this pipeline would otherwise reintroduce one layer down: the MDES PDF
		 * writes `ำ` as two codepoints throughout, exactly as its HTML does.
		 */
		it("canonicalises Thai, so the text is comparable to a user's keyword", async () => {
			const { text } = await extractor.extract(
				fixture("mdes-announcement.fixture.pdf")
			);

			expect(text).not.toContain("ํา");
			expect(text).toContain("ดำรงตำแหน่ง");
		});

		it("collapses the stray breaks a text layer comes with", async () => {
			const { text } = await extractor.extract(
				fixture("mdes-announcement.fixture.pdf")
			);

			expect(text).not.toMatch(/\s{2,}/);
			expect(text).not.toMatch(/^\s|\s$/);
		});
	});

	describe("a scanned announcement", () => {
		/**
		 * DOL publishes scans. This is the case `INSUFFICIENT_TEXT` exists for, and the reason
		 * "is the text empty?" is the wrong test — a scan yields a little header junk, not
		 * nothing, on the full 20-page original.
		 */
		it("parses fine and returns no usable text", async () => {
			const result = await extractor.extract(fixture("dol-scanned.fixture.pdf"));

			expect(result.pageCount).toBe(1);
			expect(result.text.length).toBeLessThan(200);
		});
	});

	describe("something that is not a readable PDF", () => {
		it("raises PdfUnreadableError rather than returning empty text", async () => {
			await expect(
				extractor.extract(new TextEncoder().encode("this is not a pdf"))
			).rejects.toThrow(PdfUnreadableError);
		});

		it("raises for a truncated PDF", async () => {
			const truncated = fixture("mdes-announcement.fixture.pdf").subarray(0, 400);
			await expect(extractor.extract(truncated)).rejects.toThrow(PdfUnreadableError);
		});
	});
});

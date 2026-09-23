import { normalizeThaiText } from "@/shared/utils/thai-text.util";
import { Injectable } from "@nestjs/common";
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfExtractionResult {
	text: string;
	pageCount: number;
}

/** A PDF this reader cannot parse at all — malformed, encrypted, or not a PDF. */
export class PdfUnreadableError extends Error {}

/**
 * The PDF's own text layer.
 *
 * Deliberately knows nothing about attachments, queues or the database: it takes bytes and
 * returns text, which is what makes it testable against a real announcement with no network.
 *
 * It does **not** decide whether the text is enough — that judgement belongs with the caller
 * that knows the threshold, and keeping it out of here is what lets OCR reuse this class as
 * the first of two attempts rather than as a competitor to it.
 */
@Injectable()
export class PdfTextExtractor {
	async extract(bytes: Uint8Array): Promise<PdfExtractionResult> {
		try {
			const document = await getDocumentProxy(bytes);
			const { totalPages, text } = await extractText(document, {
				mergePages: true,
			});

			return {
				// Canonicalised here rather than at the call site: PDF text carries the same two
				// spellings of `ำ` that the HTML does — the MDES announcement uses the
				// two-codepoint form throughout — and text that will be searched has to be
				// comparable to what a user typed.
				text: normalizeThaiText(collapseWhitespace(text)),
				pageCount: totalPages,
			};
		} catch (error) {
			throw new PdfUnreadableError(
				error instanceof Error ? error.message : String(error)
			);
		}
	}
}

/**
 * PDF text extraction emits a token per positioned run, so the raw output is full of stray
 * breaks mid-sentence. Collapsing runs of whitespace makes the text searchable; paragraph
 * structure is not recoverable from a text layer anyway.
 */
const collapseWhitespace = (text: string): string =>
	text.replace(/\s+/g, " ").trim();

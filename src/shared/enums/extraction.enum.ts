/**
 * How far a document has got through the extraction pipeline.
 *
 * `INSUFFICIENT_TEXT` is named for what happened rather than for what to do about it. A
 * scanned announcement has no text layer at all — the DOL fixture yields 0 characters from
 * 20 pages — and calling that COMPLETED would be a lie, FAILED would be wrong (nothing
 * broke), and `NEEDS_OCR` would encode a plan into a state column that must stay true whether
 * or not OCR ever ships. OCR picks its work up with a single predicate on this value.
 */
export enum ExtractionStatus {
	PENDING = "PENDING",
	PROCESSING = "PROCESSING",
	COMPLETED = "COMPLETED",
	/** Parsed fine, but there is no meaningful text layer to read. */
	INSUFFICIENT_TEXT = "INSUFFICIENT_TEXT",
	/** The document could not be fetched or parsed at all; see `extractionError`. */
	FAILED = "FAILED",
}

/** Which reader produced `extractedText`. */
export enum ExtractionMethod {
	/** The PDF's own text layer. */
	TEXT = "TEXT",
	/** Optical character recognition over the rendered pages. */
	OCR = "OCR",
}

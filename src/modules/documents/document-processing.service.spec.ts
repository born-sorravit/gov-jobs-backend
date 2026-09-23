import { DocumentProcessingService } from "@/modules/documents/document-processing.service";
import { DocumentUnavailableError } from "@/modules/documents/document-download.service";
import { PdfUnreadableError } from "@/modules/documents/pdf-text.extractor";
import { ExtractionMethod, ExtractionStatus } from "@/shared/enums/extraction.enum";

interface Row {
	id: string;
	url: string;
	fileHash: string | null;
	extractionStatus: ExtractionStatus;
	extractionMethod: ExtractionMethod | null;
	extractedText: string | null;
	extractionError: string | null;
}

const row = (over: Partial<Row> = {}): Row => ({
	id: "att-1",
	url: "https://example.test/a.pdf",
	fileHash: null,
	extractionStatus: ExtractionStatus.PENDING,
	extractionMethod: null,
	extractedText: null,
	extractionError: null,
	...over,
});

/** A repository over an array, so these assert the decisions rather than the SQL. */
const repositoryOf = (rows: Row[]) => ({
	findOne: jest.fn(async ({ where }: { where: unknown }) => {
		const clauses = Array.isArray(where) ? where : [where];
		for (const clause of clauses as Record<string, unknown>[]) {
			const found = rows.find((r) => {
				if (clause.id && typeof clause.id === "string" && r.id !== clause.id) {
					return false;
				}
				// `Not(excludeId)` — only its shape matters here.
				if (clause.id && typeof clause.id === "object") {
					const value = (clause.id as { value?: string }).value;
					if (value !== undefined && r.id === value) return false;
				}
				if (clause.fileHash && r.fileHash !== clause.fileHash) return false;
				if (
					clause.extractionStatus &&
					r.extractionStatus !== clause.extractionStatus
				) {
					return false;
				}
				return true;
			});
			if (found) return found;
		}
		return null;
	}),
	update: jest.fn(async (id: string, changes: Partial<Row>) => {
		Object.assign(rows.find((r) => r.id === id) as Row, changes);
		return { affected: 1 };
	}),
});

const CONFIG = { maxBytes: 10_000_000, minTextLength: 200, timeoutMs: 5000 };

const build = (
	rows: Row[],
	download: unknown,
	extract: unknown
): {
	service: DocumentProcessingService;
	repository: ReturnType<typeof repositoryOf>;
	matchingQueue: { add: jest.Mock };
} => {
	const repository = repositoryOf(rows);
	const matchingQueue = { add: jest.fn().mockResolvedValue(undefined) };
	const service = new DocumentProcessingService(
		repository as never,
		{ download } as never,
		{ extract } as never,
		matchingQueue as never,
		{ getOrThrow: () => CONFIG } as never
	);
	return { service, repository, matchingQueue };
};

const downloaded = (hash = "hash-1") => ({
	bytes: new Uint8Array([1, 2, 3]),
	hash,
	byteLength: 3,
	contentType: "application/pdf",
});

describe("DocumentProcessingService", () => {
	it("records text that is long enough as COMPLETED", async () => {
		const rows = [row()];
		const text = "ก".repeat(500);
		const { service } = build(
			rows,
			async () => downloaded(),
			async () => ({ text, pageCount: 12 })
		);

		const result = await service.process("att-1");

		expect(result).toMatchObject({
			status: ExtractionStatus.COMPLETED,
			textLength: 500,
			reusedByHash: false,
		});
		expect(rows[0]).toMatchObject({
			extractionStatus: ExtractionStatus.COMPLETED,
			extractionMethod: ExtractionMethod.TEXT,
			extractedText: text,
			fileHash: "hash-1",
		});
	});

	/**
	 * The branch the pipeline exists to distinguish. A scan parses perfectly and yields a
	 * handful of characters — that is neither success nor failure, and OCR finds its work by
	 * this status alone.
	 */
	it("records a scan as INSUFFICIENT_TEXT, not COMPLETED or FAILED", async () => {
		const rows = [row()];
		const { service } = build(
			rows,
			async () => downloaded(),
			async () => ({ text: "หน้า 1", pageCount: 20 })
		);

		const result = await service.process("att-1");

		expect(result.status).toBe(ExtractionStatus.INSUFFICIENT_TEXT);
		expect(rows[0]).toMatchObject({
			extractionStatus: ExtractionStatus.INSUFFICIENT_TEXT,
			// The text layer *was* read; the status says what it contained.
			extractionMethod: ExtractionMethod.TEXT,
			extractedText: "หน้า 1",
			extractionError: null,
		});
	});

	it("keeps the short text as the evidence for the verdict", async () => {
		const rows = [row()];
		const { service } = build(
			rows,
			async () => downloaded(),
			async () => ({ text: "x", pageCount: 1 })
		);

		await service.process("att-1");

		expect(rows[0].extractedText).toBe("x");
	});

	describe("documents that cannot be read", () => {
		it.each([
			[
				"an unreachable file",
				async () => {
					throw new DocumentUnavailableError("GET … returned 404");
				},
				async () => ({ text: "", pageCount: 0 }),
			],
			[
				"a file that is not a readable PDF",
				async () => downloaded(),
				async () => {
					throw new PdfUnreadableError("Invalid PDF structure");
				},
			],
		])("records %s as FAILED with the reason", async (_label, dl, ex) => {
			const rows = [row()];
			const { service } = build(rows, dl, ex);

			const result = await service.process("att-1");

			expect(result.status).toBe(ExtractionStatus.FAILED);
			expect(rows[0].extractionStatus).toBe(ExtractionStatus.FAILED);
			expect(rows[0].extractionError).toBeTruthy();
		});

		/** A row stuck in PROCESSING forever is worse than one that says why it failed. */
		it("never leaves the row in PROCESSING", async () => {
			const rows = [row()];
			const { service } = build(
				rows,
				async () => {
					throw new Error("something entirely unexpected");
				},
				async () => ({ text: "", pageCount: 0 })
			);

			await service.process("att-1");

			expect(rows[0].extractionStatus).not.toBe(ExtractionStatus.PROCESSING);
		});
	});

	describe("the same file under two announcements", () => {
		it("copies an already-read result instead of parsing again", async () => {
			const rows = [
				row({
					id: "att-old",
					fileHash: "shared",
					extractionStatus: ExtractionStatus.COMPLETED,
					extractionMethod: ExtractionMethod.TEXT,
					extractedText: "เนื้อหาประกาศ",
				}),
				row({ id: "att-new" }),
			];
			const extract = jest.fn();
			const { service } = build(rows, async () => downloaded("shared"), extract);

			const result = await service.process("att-new");

			expect(extract).not.toHaveBeenCalled();
			expect(result.reusedByHash).toBe(true);
			expect(rows[1]).toMatchObject({
				extractionStatus: ExtractionStatus.COMPLETED,
				extractedText: "เนื้อหาประกาศ",
				fileHash: "shared",
			});
		});

		/**
		 * A failure is usually about the fetch rather than the file, so copying one would turn
		 * a transient network problem into a permanent verdict on every announcement that
		 * shares the document.
		 */
		it("does not copy a FAILED result", async () => {
			const rows = [
				row({
					id: "att-old",
					fileHash: "shared",
					extractionStatus: ExtractionStatus.FAILED,
					extractionError: "timed out",
				}),
				row({ id: "att-new" }),
			];
			const extract = jest
				.fn()
				.mockResolvedValue({ text: "ก".repeat(400), pageCount: 3 });
			const { service } = build(rows, async () => downloaded("shared"), extract);

			const result = await service.process("att-new");

			expect(extract).toHaveBeenCalled();
			expect(result.reusedByHash).toBe(false);
			expect(rows[1].extractionStatus).toBe(ExtractionStatus.COMPLETED);
		});
	});

	/**
	 * The mechanism the whole feature rests on. `extractedText` is not part of
	 * `content_hash`, so reading a document never makes the announcement look changed and the
	 * crawl's matching pass already ran before the text existed.
	 */
	describe("re-matching once the text exists", () => {
		it("queues the announcement for matching after a COMPLETED read", async () => {
			const rows = [row({ id: "att-1" })];
			const { service, matchingQueue } = build(
				rows,
				async () => downloaded(),
				async () => ({ text: "ก".repeat(500), pageCount: 3 })
			);

			await service.process("att-1");

			expect(matchingQueue.add).toHaveBeenCalledTimes(1);
			const [, payload, opts] = matchingQueue.add.mock.calls[0];
			expect(payload).toMatchObject({ crawlerRunId: null });
			// Keyed on the attachment: the crawl already used the announcement's content hash,
			// and a completed job under that id would make this a silent duplicate.
			expect(opts.jobId).toContain("att-1");
			expect(opts.removeOnComplete).toBe(true);
		});

		it("queues it after reusing an already-read document too", async () => {
			const rows = [
				row({
					id: "att-old",
					fileHash: "shared",
					extractionStatus: ExtractionStatus.COMPLETED,
					extractedText: "เนื้อหา",
				}),
				row({ id: "att-new" }),
			];
			const { service, matchingQueue } = build(
				rows,
				async () => downloaded("shared"),
				jest.fn()
			);

			await service.process("att-new");

			expect(matchingQueue.add).toHaveBeenCalledTimes(1);
		});

		it.each([
			[
				"a scan",
				async () => downloaded(),
				async () => ({ text: "หน้า 1", pageCount: 20 }),
			],
			[
				"an unreadable document",
				async () => {
					throw new DocumentUnavailableError("GET … returned 404");
				},
				async () => ({ text: "", pageCount: 0 }),
			],
		])("does not queue matching for %s", async (_label, dl, ex) => {
			const { service, matchingQueue } = build([row()], dl, ex);

			await service.process("att-1");

			expect(matchingQueue.add).not.toHaveBeenCalled();
		});
	});

	it("does nothing for an attachment deleted between enqueue and delivery", async () => {
		const extract = jest.fn();
		const { service } = build([], async () => downloaded(), extract);

		const result = await service.process("gone");

		expect(extract).not.toHaveBeenCalled();
		expect(result.textLength).toBe(0);
	});
});

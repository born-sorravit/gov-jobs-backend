import {
	DocumentDownloadService,
	DocumentUnavailableError,
} from "@/modules/documents/document-download.service";
import { createHash } from "node:crypto";

const CONFIG = { maxBytes: 1000, minTextLength: 200, timeoutMs: 5000 };

const service = (): DocumentDownloadService =>
	new DocumentDownloadService({
		getOrThrow: (key: string) =>
			key === "document" ? CONFIG : "gov-jobs-alert/1.0 (test)",
	} as never);

/** A response whose body is a real stream, so the capped reader is actually exercised. */
const respond = (
	body: Uint8Array,
	init: { status?: number; headers?: Record<string, string> } = {}
): Response =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				// Several chunks, because a cap that only works on one-chunk bodies is not a cap.
				for (let i = 0; i < body.length; i += 64) {
					controller.enqueue(body.subarray(i, i + 64));
				}
				controller.close();
			},
		}),
		{
			status: init.status ?? 200,
			headers: { "content-type": "application/pdf", ...(init.headers ?? {}) },
		}
	);

const pdfBytes = (size: number): Uint8Array => {
	const bytes = new Uint8Array(size);
	bytes.set(new TextEncoder().encode("%PDF-1.7\n"), 0);
	return bytes;
};

describe("DocumentDownloadService", () => {
	const fetchMock = jest.spyOn(globalThis, "fetch");

	afterEach(() => fetchMock.mockReset());
	afterAll(() => fetchMock.mockRestore());

	it("returns the bytes, their size and their SHA-256", async () => {
		const bytes = pdfBytes(256);
		fetchMock.mockResolvedValue(respond(bytes));

		const result = await service().download("https://example.test/a.pdf");

		expect(result.byteLength).toBe(256);
		expect(result.hash).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(result.contentType).toBe("application/pdf");
	});

	/** The header is a claim; refusing on it saves downloading the file to find out. */
	it("refuses a document whose declared size is over the cap", async () => {
		fetchMock.mockResolvedValue(
			respond(pdfBytes(64), { headers: { "content-length": "999999" } })
		);

		await expect(service().download("https://example.test/big.pdf")).rejects.toThrow(
			/over the 1000 limit/
		);
	});

	/**
	 * And the claim can be absent or wrong, which is the case that actually protects a 512 MB
	 * instance from a source that publishes a 200 MB scan.
	 */
	it("abandons a download that passes the cap mid-stream", async () => {
		fetchMock.mockResolvedValue(respond(pdfBytes(4000)));

		await expect(
			service().download("https://example.test/lying.pdf")
		).rejects.toThrow(/exceeded the 1000 byte limit/);
	});

	/** A site answering an HTML error page with `200 application/pdf` is the real case. */
	it("refuses a body that is not a PDF, whatever the headers say", async () => {
		fetchMock.mockResolvedValue(
			respond(new TextEncoder().encode("<html>ไม่พบหน้านี้</html>"))
		);

		await expect(service().download("https://example.test/x.pdf")).rejects.toThrow(
			DocumentUnavailableError
		);
	});

	it.each([
		["a non-2xx response", () => respond(pdfBytes(64), { status: 404 })],
		["an empty body", () => respond(new Uint8Array(0))],
	])("raises for %s", async (_label, build) => {
		fetchMock.mockResolvedValue(build());

		await expect(service().download("https://example.test/x.pdf")).rejects.toThrow(
			DocumentUnavailableError
		);
	});

	it("wraps a network failure rather than letting it escape raw", async () => {
		fetchMock.mockRejectedValue(new Error("ECONNRESET"));

		await expect(service().download("https://example.test/x.pdf")).rejects.toThrow(
			DocumentUnavailableError
		);
	});

	it("identifies the crawler honestly", async () => {
		fetchMock.mockResolvedValue(respond(pdfBytes(64)));

		await service().download("https://example.test/a.pdf");

		const [, init] = fetchMock.mock.calls[0];
		expect((init?.headers as Record<string, string>)["User-Agent"]).toContain(
			"gov-jobs-alert"
		);
	});
});

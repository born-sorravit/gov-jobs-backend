import { DocumentConfig } from "@/config/configuration";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";

export interface DownloadedDocument {
	bytes: Uint8Array;
	/** SHA-256 of the bytes, hex. */
	hash: string;
	byteLength: number;
	contentType: string | null;
}

/** The document could not be fetched, was too large, or was not a PDF. */
export class DocumentUnavailableError extends Error {}

const PDF_MAGIC = "%PDF-";

/**
 * Fetches one document, with the limits that keep a bad file from taking the instance down.
 *
 * The process that reads documents is the one serving the API, on 512 MB. A source is free to
 * publish a 200 MB scan, so the size cap is enforced twice — once on the advertised
 * `content-length`, and again while reading, because that header is a claim rather than a
 * guarantee.
 */
@Injectable()
export class DocumentDownloadService {
	private readonly logger = new Logger(DocumentDownloadService.name);
	private readonly config: DocumentConfig;
	private readonly userAgent: string;

	constructor(configService: ConfigService) {
		this.config = configService.getOrThrow<DocumentConfig>("document");
		this.userAgent = configService.getOrThrow<string>("crawler.userAgent");
	}

	async download(url: string): Promise<DownloadedDocument> {
		const response = await this.fetchOrThrow(url);

		const declared = Number.parseInt(
			response.headers.get("content-length") ?? "",
			10
		);
		if (Number.isFinite(declared) && declared > this.config.maxBytes) {
			throw new DocumentUnavailableError(
				`document is ${declared} bytes, over the ${this.config.maxBytes} limit`
			);
		}

		const bytes = await this.readCapped(response, url);
		const contentType = response.headers.get("content-type");

		// MDES serves attachments from an extensionless `content/download-detail/{id}`, so the
		// URL says nothing about the format. The magic bytes are checked rather than the
		// header alone: a site answering an HTML error page with `200 application/pdf` is the
		// failure this actually catches.
		if (!this.looksLikePdf(bytes)) {
			throw new DocumentUnavailableError(
				`not a PDF (content-type: ${contentType ?? "none"})`
			);
		}

		return {
			bytes,
			hash: createHash("sha256").update(bytes).digest("hex"),
			byteLength: bytes.byteLength,
			contentType,
		};
	}

	private async fetchOrThrow(url: string): Promise<Response> {
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "application/pdf,*/*", "User-Agent": this.userAgent },
				signal: AbortSignal.timeout(this.config.timeoutMs),
			});
		} catch (error) {
			throw new DocumentUnavailableError(
				`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		if (!response.ok) {
			throw new DocumentUnavailableError(`GET ${url} returned ${response.status}`);
		}
		if (!response.body) {
			throw new DocumentUnavailableError(`GET ${url} returned no body`);
		}

		return response;
	}

	/**
	 * Reads the stream chunk by chunk, abandoning it the moment the cap is passed.
	 *
	 * `response.arrayBuffer()` would buffer the whole thing before anyone could object, which
	 * defeats the point of having a limit.
	 */
	private async readCapped(response: Response, url: string): Promise<Uint8Array> {
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		// Grown geometrically and written in place. Collecting chunks and merging at the end
		// peaks at **twice** the document's size — a 13 MB announcement costs 26 MB — on an
		// instance with 512 MB shared between the API, the queue pools and pdf.js, where the
		// symptom is the process dying rather than one attachment failing.
		let buffer = new Uint8Array(64 * 1024);
		let total = 0;

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;

				total += value.byteLength;
				if (total > this.config.maxBytes) {
					throw new DocumentUnavailableError(
						`document exceeded the ${this.config.maxBytes} byte limit while downloading`
					);
				}
				if (total > buffer.byteLength) {
					const grown = new Uint8Array(
						Math.min(Math.max(buffer.byteLength * 2, total), this.config.maxBytes)
					);
					grown.set(buffer.subarray(0, total - value.byteLength));
					buffer = grown;
				}

				buffer.set(value, total - value.byteLength);
			}
		} finally {
			// Releases the socket whether the read finished or was abandoned; without this an
			// oversized document would leave the connection open until it timed out.
			await reader.cancel().catch(() => undefined);
		}

		if (total === 0) {
			throw new DocumentUnavailableError(`GET ${url} returned an empty body`);
		}

		// A view, not a copy — the reader only reads it.
		return buffer.subarray(0, total);
	}

	private looksLikePdf(bytes: Uint8Array): boolean {
		const head = Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1");
		return head === PDF_MAGIC;
	}
}

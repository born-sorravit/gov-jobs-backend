import { DocumentConfig } from "@/config/configuration";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { JobAttachmentRepository } from "@/models/jobs/job-attachment.repository";
import { DocumentDownloadService } from "@/modules/documents/document-download.service";
import { PdfTextExtractor } from "@/modules/documents/pdf-text.extractor";
import { ExtractionMethod, ExtractionStatus } from "@/shared/enums/extraction.enum";
import {
	MatchJobPayload,
	QUEUE_JOB_MATCHING,
	matchAfterDocumentJobId,
} from "@/constants/queue.constants";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { Not } from "typeorm";

export interface ProcessDocumentResult {
	status: ExtractionStatus;
	textLength: number;
	/** True when the bytes were recognised from another attachment and not fetched again. */
	reusedByHash: boolean;
}

/**
 * Reads one attachment and records what came back.
 *
 * Always resolves to a status, never throws for a document-level problem: a PDF that cannot
 * be fetched or parsed is a fact about that document, recorded on its row, not a reason to
 * retry forever. The processor only sees an exception when something infrastructural broke.
 */
@Injectable()
export class DocumentProcessingService {
	private readonly logger = new Logger(DocumentProcessingService.name);
	private readonly config: DocumentConfig;

	constructor(
		private readonly attachmentRepository: JobAttachmentRepository,
		private readonly downloadService: DocumentDownloadService,
		private readonly textExtractor: PdfTextExtractor,
		@InjectQueue(QUEUE_JOB_MATCHING)
		private readonly matchingQueue: Queue<MatchJobPayload>,
		configService: ConfigService
	) {
		this.config = configService.getOrThrow<DocumentConfig>("document");
	}

	async process(attachmentId: string): Promise<ProcessDocumentResult> {
		const attachment = await this.attachmentRepository.findOne({
			where: { id: attachmentId },
		});

		// Deleted between enqueue and delivery — an attachment is replaced whenever its
		// announcement republishes the file. Nothing to do and nothing to retry.
		if (!attachment) {
			return {
				status: ExtractionStatus.FAILED,
				textLength: 0,
				reusedByHash: false,
			};
		}

		await this.attachmentRepository.update(attachment.id, {
			extractionStatus: ExtractionStatus.PROCESSING,
			extractionError: null,
		});

		try {
			return await this.readAndRecord(attachment);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			// `DocumentUnavailableError` and `PdfUnreadableError` are both "this document is
			// not readable", which is a result. Anything else is unexpected and worth the same
			// treatment here — a stuck PROCESSING row is worse than a recorded failure.
			this.logger.warn(`Attachment ${attachment.id} failed: ${message}`);
			await this.attachmentRepository.update(attachment.id, {
				extractionStatus: ExtractionStatus.FAILED,
				extractionError: message,
				processedAt: new Date(),
			});

			return {
				status: ExtractionStatus.FAILED,
				textLength: 0,
				reusedByHash: false,
			};
		}
	}

	private async readAndRecord(
		attachment: JobAttachment
	): Promise<ProcessDocumentResult> {
		const document = await this.downloadService.download(attachment.url);

		// Sources republish one file across several announcements. Copying a result we already
		// have spares the parse, and — more to the point — means a document only has to be
		// readable once.
		const twin = await this.findProcessedTwin(document.hash, attachment.id);
		if (twin) {
			await this.attachmentRepository.update(attachment.id, {
				extractionStatus: twin.extractionStatus,
				extractionMethod: twin.extractionMethod,
				extractedText: twin.extractedText,
				extractionError: null,
				fileHash: document.hash,
				fileSize: document.byteLength,
				processedAt: new Date(),
			});

			await this.requeueMatching(attachment, twin.extractionStatus);

			return {
				status: twin.extractionStatus,
				textLength: twin.extractedText?.length ?? 0,
				reusedByHash: true,
			};
		}

		const { text, pageCount } = await this.textExtractor.extract(document.bytes);

		/**
		 * A scan is not empty — it yields a few characters of header junk — so the test cannot
		 * be "is it zero". Below the threshold the document is recorded as having no usable
		 * text layer rather than as complete or failed, which is what OCR will look for.
		 */
		const hasUsableText = text.length >= this.config.minTextLength;
		const status = hasUsableText
			? ExtractionStatus.COMPLETED
			: ExtractionStatus.INSUFFICIENT_TEXT;

		await this.attachmentRepository.update(attachment.id, {
			extractionStatus: status,
			// The text layer was read either way; `INSUFFICIENT_TEXT` says what it contained,
			// not that nothing was tried.
			extractionMethod: ExtractionMethod.TEXT,
			// Kept even when short: it costs nothing and it is the evidence for the verdict.
			extractedText: text === "" ? null : text,
			extractionError: null,
			fileHash: document.hash,
			fileSize: document.byteLength,
			processedAt: new Date(),
		});

		await this.requeueMatching(attachment, status);

		this.logger.log(
			`Attachment ${attachment.id}: ${pageCount} page(s), ${text.length} chars, ${status}`
		);

		return { status, textLength: text.length, reusedByHash: false };
	}

	/**
	 * Matches the announcement again now that its text exists.
	 *
	 * Without this the feature does not work at all: `extractedText` is deliberately not part
	 * of `content_hash`, so reading a document never makes the announcement look changed, and
	 * the crawl's own matching pass ran before the text arrived. The announcement would only
	 * be matched against its documents on some later crawl where it changed for an unrelated
	 * reason.
	 *
	 * Only after a `COMPLETED` read — there is nothing new to match on otherwise. Re-matching
	 * is safe to repeat: `uq_job_alert_match_alert_job` is what guarantees one notification
	 * per (alert, announcement), however many times this runs.
	 */
	private async requeueMatching(
		attachment: JobAttachment,
		status: ExtractionStatus
	): Promise<void> {
		if (status !== ExtractionStatus.COMPLETED) return;

		await this.matchingQueue.add(
			"match",
			{ jobId: attachment.jobId, crawlerRunId: null },
			{
				jobId: matchAfterDocumentJobId(attachment.id),
				// Dropped on success so a later re-read of the same document can match again;
				// the shared 24-hour retention would make the second attempt a silent duplicate.
				removeOnComplete: true,
			}
		);
	}

	/**
	 * Another attachment with the same bytes that has already been read.
	 *
	 * `FAILED` twins are ignored on purpose: a failure is usually about the fetch rather than
	 * the file, so copying one would turn a transient network problem into a permanent verdict
	 * on every announcement that shares the document.
	 */
	private async findProcessedTwin(
		fileHash: string,
		excludeId: string
	): Promise<JobAttachment | null> {
		return this.attachmentRepository.findOne({
			where: [
				{
					fileHash,
					id: Not(excludeId),
					extractionStatus: ExtractionStatus.COMPLETED,
				},
				{
					fileHash,
					id: Not(excludeId),
					extractionStatus: ExtractionStatus.INSUFFICIENT_TEXT,
				},
			],
		});
	}
}

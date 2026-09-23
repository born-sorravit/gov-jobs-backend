import {
	DocumentJobPayload,
	QUEUE_DOCUMENT_PROCESSING,
} from "@/constants/queue.constants";
import { DocumentProcessingService } from "@/modules/documents/document-processing.service";
import { ExtractionStatus } from "@/shared/enums/extraction.enum";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

/**
 * Reads one attachment.
 *
 * **Concurrency 1.** Each queue holds a dedicated LISTEN client plus a small pool against the
 * same Supabase instance the API uses, and this is the only worker that also holds a whole
 * PDF in memory on a 512 MB box. Announcements are not waiting on anything, so a longer wall
 * clock costs nothing that matters — the same trade `runAll` makes.
 */
@Processor(QUEUE_DOCUMENT_PROCESSING, { concurrency: 1 })
export class DocumentProcessingProcessor extends WorkerHost {
	private readonly logger = new Logger(DocumentProcessingProcessor.name);

	constructor(private readonly processingService: DocumentProcessingService) {
		super();
	}

	async process(job: Job<DocumentJobPayload>): Promise<{
		status: ExtractionStatus;
		textLength: number;
	}> {
		const { status, textLength, reusedByHash } =
			await this.processingService.process(job.data.attachmentId);

		if (reusedByHash) {
			this.logger.log(
				`Attachment ${job.data.attachmentId} reused an already-read document`
			);
		}

		// Deliberately does not throw on FAILED. The service records why on the row, and a
		// document that is genuinely unreadable would otherwise be retried five times and then
		// sit in the failed set forever, telling nobody anything the row does not already say.
		return { status, textLength };
	}
}

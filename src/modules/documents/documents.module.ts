import {
	QUEUE_DOCUMENT_PROCESSING,
	QUEUE_JOB_MATCHING,
} from "@/constants/queue.constants";
import { DocumentDownloadService } from "@/modules/documents/document-download.service";
import { DocumentProcessingProcessor } from "@/modules/documents/document-processing.processor";
import { DocumentProcessingService } from "@/modules/documents/document-processing.service";
import { PdfTextExtractor } from "@/modules/documents/pdf-text.extractor";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

@Module({
	imports: [
		BullModule.registerQueue(
			{ name: QUEUE_DOCUMENT_PROCESSING },
			// Produced onto, not consumed here: reading a document is what makes an
			// announcement worth matching again. A queue registration rather than a dependency
			// on JobAlertsModule, which would be a cycle.
			{ name: QUEUE_JOB_MATCHING }
		),
	],
	providers: [
		DocumentProcessingService,
		DocumentDownloadService,
		PdfTextExtractor,
		DocumentProcessingProcessor,
	],
	exports: [DocumentProcessingService],
})
export class DocumentsModule {}

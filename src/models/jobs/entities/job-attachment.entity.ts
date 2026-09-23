import { BaseEntity } from "@/models/base.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { ExtractionMethod, ExtractionStatus } from "@/shared/enums/extraction.enum";
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";

export enum JobAttachmentType {
	ANNOUNCEMENT_PDF = "ANNOUNCEMENT_PDF",
	OTHER = "OTHER",
}

@Entity("job_attachment")
@Unique("uq_job_attachment_job_url", ["jobId", "url"])
export class JobAttachment extends BaseEntity {
	@Index("idx_job_attachment_job_id")
	@Column({ name: "job_id", type: "uuid" })
	jobId: string;

	@ManyToOne(
		() => Job,
		(job) => job.attachments,
		{ onDelete: "CASCADE" }
	)
	@JoinColumn({ name: "job_id" })
	job: Job;

	@Column({ type: "varchar", length: 500 })
	name: string;

	@Column({ type: "text" })
	url: string;

	@Column({
		type: "enum",
		enum: JobAttachmentType,
		default: JobAttachmentType.OTHER,
	})
	type: JobAttachmentType;

	// --- Document processing -------------------------------------------------

	/**
	 * Indexed because the worker's only query is "what is still PENDING", and OCR's will be
	 * "what is INSUFFICIENT_TEXT" — both want to find a handful of rows in a growing table.
	 */
	@Index("idx_job_attachment_extraction_status")
	@Column({
		name: "extraction_status",
		type: "enum",
		enum: ExtractionStatus,
		default: ExtractionStatus.PENDING,
	})
	extractionStatus: ExtractionStatus;

	@Column({
		name: "extraction_method",
		type: "enum",
		enum: ExtractionMethod,
		nullable: true,
	})
	extractionMethod: ExtractionMethod | null;

	/**
	 * The document's text, canonicalised the same way announcement titles are — the two
	 * spellings of `ำ` appear in PDF text too, and text that will be searched has to be
	 * comparable to what a user typed.
	 */
	@Column({ name: "extracted_text", type: "text", nullable: true })
	extractedText: string | null;

	@Column({ name: "extraction_error", type: "text", nullable: true })
	extractionError: string | null;

	/**
	 * SHA-256 of the bytes.
	 *
	 * Sources republish the same file under several announcements, so this is what makes
	 * "have we already read this?" answerable without re-downloading and re-parsing it.
	 */
	@Index("idx_job_attachment_file_hash")
	@Column({ name: "file_hash", type: "varchar", length: 64, nullable: true })
	fileHash: string | null;

	@Column({ name: "file_size", type: "int", nullable: true })
	fileSize: number | null;

	@Column({ name: "processed_at", type: "timestamptz", nullable: true })
	processedAt: Date | null;
}

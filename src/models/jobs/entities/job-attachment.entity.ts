import { BaseEntity } from "@/models/base.entity";
import { Job } from "@/models/jobs/entities/job.entity";
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
}

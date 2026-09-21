import { BaseEntity } from "@/models/base.entity";
import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";

/**
 * One row per (alert, job) pair, ever. The unique constraint is the last line of defence
 * against duplicate notifications: even if the matcher runs twice, the second insert fails.
 *
 * `notifiedAt` stays null until the email actually goes out, which is what the digest
 * frequencies select on.
 */
@Entity("job_alert_match")
@Unique("uq_job_alert_match_alert_job", ["jobAlertId", "jobId"])
@Index("idx_job_alert_match_pending", ["jobAlertId", "notifiedAt"])
export class JobAlertMatch extends BaseEntity {
	@Column({ name: "job_alert_id", type: "uuid" })
	jobAlertId: string;

	@ManyToOne(() => JobAlert, { onDelete: "CASCADE" })
	@JoinColumn({ name: "job_alert_id" })
	jobAlert: JobAlert;

	@Column({ name: "job_id", type: "uuid" })
	jobId: string;

	@ManyToOne(() => Job, { onDelete: "CASCADE" })
	@JoinColumn({ name: "job_id" })
	job: Job;

	@Column({ name: "matched_at", type: "timestamptz", default: () => "now()" })
	matchedAt: Date;

	@Column({ name: "notified_at", type: "timestamptz", nullable: true })
	notifiedAt: Date | null;
}

import { BaseEntity } from "@/models/base.entity";
import { EmailLogStatus } from "@/shared/enums/email-log-status.enum";
import { Column, Entity, Index } from "typeorm";

/**
 * Every outbound email, whatever the provider. Gives the admin dashboard a delivery view
 * and makes "did this user already get told about this job?" answerable after the fact.
 */
@Entity("email_log")
@Index("idx_email_log_created_at", ["createdAt"])
export class EmailLog extends BaseEntity {
	@Index("idx_email_log_to_email")
	@Column({ name: "to_email", type: "varchar", length: 255 })
	toEmail: string;

	@Column({ type: "varchar", length: 500 })
	subject: string;

	/** Template key, e.g. `job-alert-immediate`. Not the rendered body. */
	@Column({ type: "varchar", length: 64 })
	template: string;

	@Column({
		type: "enum",
		enum: EmailLogStatus,
		default: EmailLogStatus.QUEUED,
	})
	status: EmailLogStatus;

	@Column({ name: "provider", type: "varchar", length: 32 })
	provider: string;

	@Column({
		name: "provider_message_id",
		type: "varchar",
		length: 255,
		nullable: true,
	})
	providerMessageId: string | null;

	@Column({ name: "job_alert_id", type: "uuid", nullable: true })
	jobAlertId: string | null;

	@Column({ name: "user_id", type: "uuid", nullable: true })
	userId: string | null;

	@Column({ name: "sent_at", type: "timestamptz", nullable: true })
	sentAt: Date | null;

	@Column({ name: "error_message", type: "text", nullable: true })
	errorMessage: string | null;
}

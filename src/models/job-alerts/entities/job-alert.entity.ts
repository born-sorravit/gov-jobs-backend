import { BaseEntity } from "@/models/base.entity";
import { User } from "@/models/users/entities/user.entity";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/**
 * A user's saved search plus a delivery schedule.
 *
 * Every filter is OR-within / AND-across: a job matches when it hits *any* keyword AND
 * *any* selected job type AND *any* selected education AND *any* selected province. An
 * empty filter array means "no constraint on this dimension".
 */
@Entity("job_alert")
export class JobAlert extends BaseEntity {
	@Index("idx_job_alert_user_id")
	@Column({ name: "user_id", type: "uuid" })
	userId: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user: User;

	@Column({ type: "varchar", length: 120 })
	name: string;

	@Column({ type: "text", array: true, default: () => "'{}'" })
	keywords: string[];

	/** Position-type ids (`reference_item` kind JOB_TYPE). */
	@Column({ name: "job_types", type: "int", array: true, default: () => "'{}'" })
	jobTypes: number[];

	@Column({ type: "int", array: true, default: () => "'{}'" })
	educations: number[];

	@Column({ type: "int", array: true, default: () => "'{}'" })
	provinces: number[];

	@Column({ name: "notification_email", type: "varchar", length: 255 })
	notificationEmail: string;

	@Column({
		type: "enum",
		enum: AlertFrequency,
		enumName: "alert_frequency_enum",
		default: AlertFrequency.IMMEDIATE,
	})
	frequency: AlertFrequency;

	@Column({ name: "is_active", type: "boolean", default: true })
	isActive: boolean;

	/**
	 * The floor for matching: only jobs whose `first_seen_at` is at or after this instant
	 * can match. Without it, a brand-new alert would immediately email the entire archive.
	 * Set to `now()` on create, and moved forward when a paused alert is resumed.
	 */
	@Column({ name: "match_from", type: "timestamptz", default: () => "now()" })
	matchFrom: Date;

	@Column({ name: "last_sent_at", type: "timestamptz", nullable: true })
	lastSentAt: Date | null;
}

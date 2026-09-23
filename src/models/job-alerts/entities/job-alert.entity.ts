import { BaseEntity } from "@/models/base.entity";
import { User } from "@/models/users/entities/user.entity";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { newUnsubscribeToken } from "@/shared/utils/unsubscribe-token";
import { BeforeInsert, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

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

	/**
	 * Always the owner account's email — the API has no way to set it to anything else, and
	 * the account's own address is not editable, so it cannot drift afterwards.
	 */
	@Column({ name: "notification_email", type: "varchar", length: 255 })
	notificationEmail: string;

	/**
	 * Bearer secret for switching this alert off from an email, with no account and no login.
	 *
	 * Unguessable and unique, so the link in one person's email cannot silence anyone else's
	 * alert. Stored rather than derived from the id so it can be rotated, and so a leaked
	 * link can be invalidated without deleting the alert.
	 */
	@Index("uq_job_alert_unsubscribe_token", { unique: true })
	@Column({ name: "unsubscribe_token", type: "varchar", length: 64 })
	unsubscribeToken: string;

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

	/**
	 * The token is an invariant of the row, not something each caller has to remember.
	 *
	 * Generated here so no code path can create an alert that has no way to be switched off —
	 * an alert without a token would mail someone a link that 404s, which is worse than
	 * having no link at all.
	 */
	@BeforeInsert()
	ensureUnsubscribeToken(): void {
		if (!this.unsubscribeToken) {
			this.unsubscribeToken = newUnsubscribeToken();
		}
	}
}

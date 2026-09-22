import { BaseEntity } from "@/models/base.entity";
import { User } from "@/models/users/entities/user.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/**
 * One row per issued refresh token.
 *
 * Only the SHA-256 hash of the token is stored, the same way a password is: a database leak
 * then yields nothing usable. Tokens rotate on every refresh — the old row is revoked and a
 * new one issued — so a stolen token stops working as soon as the real client refreshes.
 */
@Entity("refresh_token")
export class RefreshToken extends BaseEntity {
	@Index("uq_refresh_token_hash", { unique: true })
	@Column({ name: "token_hash", type: "varchar", length: 64 })
	tokenHash: string;

	@Index("idx_refresh_token_user_id")
	@Column({ name: "user_id", type: "uuid" })
	userId: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user: User;

	@Column({ name: "expires_at", type: "timestamptz" })
	expiresAt: Date;

	/** Set when the token is rotated away or the session is signed out. */
	@Column({ name: "revoked_at", type: "timestamptz", nullable: true })
	revokedAt: Date | null;

	/**
	 * Why the token was revoked, which decides whether a late arrival gets a grace period.
	 *
	 * `rotated` means a refresh replaced it — and a browser that fired several requests at
	 * once may still be holding it, so a reuse within seconds is a race, not a theft.
	 * `logout` means the user asked to end the session, which is never forgiven.
	 */
	@Column({ name: "revoked_reason", type: "varchar", length: 16, nullable: true })
	revokedReason: "rotated" | "logout" | null;

	/** Best-effort context for a "your sessions" screen later; never used for auth. */
	@Column({ name: "user_agent", type: "varchar", length: 255, nullable: true })
	userAgent: string | null;
}

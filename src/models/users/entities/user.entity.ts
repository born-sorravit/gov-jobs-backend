import { BaseEntity } from "@/models/base.entity";
import { UserRole } from "@/shared/enums/user-role.enum";
import { Column, Entity, Index } from "typeorm";

@Entity("user")
export class User extends BaseEntity {
	@Index("uq_user_email", { unique: true })
	@Column({ type: "varchar", length: 255 })
	email: string;

	@Column({ name: "password_hash", type: "varchar", length: 255, select: false })
	passwordHash: string;

	@Column({ type: "varchar", length: 120 })
	name: string;

	@Column({
		type: "enum",
		enum: UserRole,
		default: UserRole.USER,
	})
	role: UserRole;

	@Column({ name: "is_verified", type: "boolean", default: false })
	isVerified: boolean;

	/** UI language, used to pick the locale of notification emails. */
	@Column({ type: "varchar", length: 5, default: "th" })
	locale: string;
}

import {
	BaseEntity as BaseEntityTypeOrm,
	CreateDateColumn,
	DeleteDateColumn,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

export abstract class BaseEntity extends BaseEntityTypeOrm {
	@PrimaryGeneratedColumn("uuid")
	id: string;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt: Date;

	@DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
	deletedAt?: Date | null;
}

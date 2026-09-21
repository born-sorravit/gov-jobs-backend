import { JobSource } from "@/shared/enums/job-source.enum";
import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	UpdateDateColumn,
} from "typeorm";

/**
 * The lookup tables OCSC exposes (`/provinces`, `/educationlevels`, `/jobtypes`, …).
 *
 * They all share the shape `{ id, <label> }`, so one narrow table with a `kind`
 * discriminator beats five near-identical ones — and a new source's taxonomies drop in
 * without a migration. `externalId` is the source's own integer id: it is what
 * `job.province_ids` / `job.education_level_ids` actually store.
 *
 * `nameEn` is our own translation for the EN UI; the source only ships Thai.
 */
export enum ReferenceKind {
	PROVINCE = "PROVINCE",
	EDUCATION_LEVEL = "EDUCATION_LEVEL",
	JOB_TYPE = "JOB_TYPE",
	JOB_CATEGORY = "JOB_CATEGORY",
	JOB_LEVEL = "JOB_LEVEL",
	JOB_SELECTION = "JOB_SELECTION",
	JOB_CONDITION = "JOB_CONDITION",
}

@Entity("reference_item")
@Index(["kind", "externalId"])
export class ReferenceItem {
	@PrimaryColumn({
		type: "enum",
		enum: JobSource,
	})
	source: JobSource;

	@PrimaryColumn({
		name: "kind",
		type: "enum",
		enum: ReferenceKind,
		enumName: "reference_kind_enum",
	})
	kind: ReferenceKind;

	@PrimaryColumn({ name: "external_id", type: "int" })
	externalId: number;

	@Column({ name: "name_th", type: "varchar", length: 255 })
	nameTh: string;

	@Column({ name: "name_en", type: "varchar", length: 255, nullable: true })
	nameEn: string | null;

	@Column({ name: "sort_order", type: "int", default: 0 })
	sortOrder: number;

	@CreateDateColumn({ name: "created_at", type: "timestamptz" })
	createdAt: Date;

	@UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
	updatedAt: Date;
}

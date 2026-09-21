import { BaseEntity } from "@/models/base.entity";
import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Column, Entity, Index, OneToMany, Unique } from "typeorm";

/**
 * A normalised job announcement. Field-by-field provenance is in `docs/ocsc-source.md`.
 *
 * The table is an accumulating archive: OCSC's list endpoint only returns currently-listed
 * announcements, so a job that disappears from it is closed, not deleted.
 */
@Entity("job")
@Unique("uq_job_source_external_id", ["source", "externalId"])
@Index("idx_job_application_end", ["applicationEnd"])
@Index("idx_job_published_at", ["publishedAt"])
// The default listing is "newest first for a source"; Postgres scans a btree backwards,
// so no DESC is needed here.
@Index("idx_job_source_published_at", ["source", "publishedAt"])
// Array-overlap (&&) filters and alert matching need GIN, not btree.
@Index("idx_job_province_ids", ["provinceIds"], { type: "gin" })
@Index("idx_job_education_level_ids", ["educationLevelIds"], { type: "gin" })
export class Job extends BaseEntity {
	@Column({ type: "enum", enum: JobSource })
	source: JobSource;

	/** The source's own announcement id. Unique per source, not globally. */
	@Column({ name: "external_id", type: "varchar", length: 120 })
	externalId: string;

	@Index("idx_job_title_trgm", { synchronize: false })
	@Column({ type: "varchar", length: 500 })
	title: string;

	@Index("idx_job_agency_trgm", { synchronize: false })
	@Column({ type: "varchar", length: 500 })
	agency: string;

	@Index("idx_job_ministry_trgm", { synchronize: false })
	@Column({ type: "varchar", length: 500, nullable: true })
	ministry: string | null;

	@Column({ name: "agency_external_id", type: "int", nullable: true })
	agencyExternalId: number | null;

	@Column({ name: "agency_seal_url", type: "text", nullable: true })
	agencySealUrl: string | null;

	// --- Taxonomy: integer ids into `reference_item`, kept as the source reports them ---

	@Column({ name: "job_category_id", type: "int", nullable: true })
	jobCategoryId: number | null;

	@Column({ name: "job_category_other", type: "text", nullable: true })
	jobCategoryOther: string | null;

	@Column({ name: "job_type_id", type: "int", nullable: true })
	jobTypeId: number | null;

	@Column({ name: "job_type_other", type: "text", nullable: true })
	jobTypeOther: string | null;

	@Column({ name: "job_level_id", type: "int", nullable: true })
	jobLevelId: number | null;

	@Column({ name: "job_level_other", type: "text", nullable: true })
	jobLevelOther: string | null;

	@Column({ name: "job_selection_id", type: "int", nullable: true })
	jobSelectionId: number | null;

	@Column({ name: "job_selection_other", type: "text", nullable: true })
	jobSelectionOther: string | null;

	@Column({ name: "job_condition_id", type: "int", nullable: true })
	jobConditionId: number | null;

	@Column({ name: "job_condition_other", type: "text", nullable: true })
	jobConditionOther: string | null;

	/**
	 * Announcements list zero or more provinces. Empty means nationwide / unspecified —
	 * it is not the same as "no location", so filters must treat it as a wildcard.
	 */
	@Column({ name: "province_ids", type: "int", array: true, default: () => "'{}'" })
	provinceIds: number[];

	@Column({
		name: "education_level_ids",
		type: "int",
		array: true,
		default: () => "'{}'",
	})
	educationLevelIds: number[];

	@Column({ name: "education_level_other", type: "text", nullable: true })
	educationLevelOther: string | null;

	// --- Free text ---

	@Column({ type: "text", nullable: true })
	description: string | null;

	@Column({ name: "education_requirements", type: "text", nullable: true })
	educationRequirements: string | null;

	@Column({ type: "text", nullable: true })
	knowledge: string | null;

	@Column({ type: "text", nullable: true })
	skill: string | null;

	@Column({ type: "text", nullable: true })
	competency: string | null;

	@Column({ type: "text", nullable: true })
	criteria: string | null;

	// --- Numbers and dates ---

	@Column({ name: "salary_min", type: "int", nullable: true })
	salaryMin: number | null;

	@Column({ name: "salary_max", type: "int", nullable: true })
	salaryMax: number | null;

	@Column({ name: "position_amount", type: "int", nullable: true })
	positionAmount: number | null;

	/** Naive dates as published; status is resolved against Asia/Bangkok. */
	@Column({ name: "application_start", type: "date", nullable: true })
	applicationStart: string | null;

	@Column({ name: "application_end", type: "date", nullable: true })
	applicationEnd: string | null;

	@Column({ name: "exam_date", type: "date", nullable: true })
	examDate: string | null;

	@Column({ name: "interview_date", type: "date", nullable: true })
	interviewDate: string | null;

	@Column({ name: "published_at", type: "timestamptz", nullable: true })
	publishedAt: Date | null;

	// --- Provenance ---

	/** The human-readable announcement page, so a user can always verify the original. */
	@Column({ name: "source_url", type: "text" })
	sourceUrl: string;

	/** Where applications are actually submitted — a different site, often a third party. */
	@Column({ name: "apply_url", type: "text", nullable: true })
	applyUrl: string | null;

	/**
	 * SHA-256 over the normalised fields, excluding view counters. An unchanged hash means
	 * the crawl writes nothing and enqueues no matching work.
	 */
	@Column({ name: "content_hash", type: "varchar", length: 64 })
	contentHash: string;

	@Column({ name: "raw_payload", type: "jsonb", nullable: true })
	rawPayload: Record<string, unknown> | null;

	/** When *we* first saw it. Alerts match on this, not on the source's publish date. */
	@Index("idx_job_first_seen_at")
	@Column({ name: "first_seen_at", type: "timestamptz", default: () => "now()" })
	firstSeenAt: Date;

	@Column({ name: "last_seen_at", type: "timestamptz", default: () => "now()" })
	lastSeenAt: Date;

	@OneToMany(
		() => JobAttachment,
		(attachment) => attachment.job
	)
	attachments: JobAttachment[];
}

import { BaseEntity } from "@/models/base.entity";
import { CrawlerRunStatus } from "@/shared/enums/crawler-run-status.enum";
import { JobSource } from "@/shared/enums/job-source.enum";
import { Column, Entity, Index } from "typeorm";

/** Audit trail for every crawl attempt. Powers the admin dashboard's crawler panel. */
@Entity("crawler_run")
@Index("idx_crawler_run_source_started_at", ["source", "startedAt"])
// At most one live run per source, enforced by the database rather than by a
// SELECT-then-INSERT: an external scheduler firing while the previous crawl is still
// going is routine, and the check-then-act version races. The second insert fails and
// the caller turns that into a 409.
@Index("uq_crawler_run_active", ["source"], {
	unique: true,
	where: "status = 'RUNNING'",
})
export class CrawlerRun extends BaseEntity {
	@Column({ type: "enum", enum: JobSource })
	source: JobSource;

	@Column({ name: "started_at", type: "timestamptz", default: () => "now()" })
	startedAt: Date;

	@Column({ name: "finished_at", type: "timestamptz", nullable: true })
	finishedAt: Date | null;

	@Column({
		type: "enum",
		enum: CrawlerRunStatus,
		default: CrawlerRunStatus.RUNNING,
	})
	status: CrawlerRunStatus;

	@Column({ name: "total_found", type: "int", default: 0 })
	totalFound: number;

	@Column({ name: "new_jobs", type: "int", default: 0 })
	newJobs: number;

	@Column({ name: "updated_jobs", type: "int", default: 0 })
	updatedJobs: number;

	/** Announcements that failed validation — logged, never fatal to the run. */
	@Column({ name: "skipped_jobs", type: "int", default: 0 })
	skippedJobs: number;

	/**
	 * Seen again with an identical `content_hash`: nothing written but `last_seen_at`, and
	 * no matching work enqueued. Counted explicitly so a healthy no-op crawl does not report
	 * all zeros and read like a failure.
	 */
	@Column({ name: "unchanged_jobs", type: "int", default: 0 })
	unchangedJobs: number;

	/**
	 * Alert matches recorded from this run's new and changed announcements. Without it the
	 * core feature is invisible — there would be no way to see matching working short of
	 * querying the database by hand.
	 */
	@Column({ name: "alert_matches", type: "int", default: 0 })
	alertMatches: number;

	@Column({ name: "error_message", type: "text", nullable: true })
	errorMessage: string | null;

	/** Whether the run was triggered by the scheduler or the internal endpoint. */
	@Column({ name: "trigger", type: "varchar", length: 32, default: "manual" })
	trigger: string;
}

import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { JobAlertMatchRepository } from "@/models/job-alerts/job-alert-match.repository";
import { JobAlertRepository } from "@/models/job-alerts/job-alert.repository";
import { Job } from "@/models/jobs/entities/job.entity";
import { JobRepository } from "@/models/jobs/job.repository";
import { Injectable, Logger } from "@nestjs/common";
import { In } from "typeorm";

/**
 * `%` and `_` are wildcards inside LIKE, so a keyword containing them would quietly match
 * far more than the user typed. `\` is escaped first or it would break the others.
 */
const escapeLike = (value: string): string =>
	value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

@Injectable()
export class AlertMatchingService {
	private readonly logger = new Logger(AlertMatchingService.name);

	constructor(
		private readonly jobRepository: JobRepository,
		private readonly jobAlertRepository: JobAlertRepository,
		private readonly jobAlertMatchRepository: JobAlertMatchRepository
	) {}

	/**
	 * Records a match for every active alert each of these announcements satisfies.
	 *
	 * Called with the ids a crawl actually inserted or materially changed, never the whole
	 * table: re-evaluating unchanged announcements would be wasted work and, without the
	 * unique constraint, duplicate notifications.
	 *
	 * Creates rows only. Delivery is step 11's — `notifiedAt` stays null here.
	 */
	async matchJobs(jobIds: string[]): Promise<string[]> {
		if (jobIds.length === 0) return [];

		const jobs = await this.jobRepository.find({ where: { id: In(jobIds) } });
		const createdIds: string[] = [];

		for (const job of jobs) {
			const alerts = await this.findMatchingAlerts(job);
			if (alerts.length === 0) continue;

			const result = await this.jobAlertMatchRepository
				.createQueryBuilder()
				.insert()
				.into(JobAlertMatch)
				.values(alerts.map((alert) => ({ jobAlertId: alert.id, jobId: job.id })))
				// `uq_job_alert_match_alert_job` is the guarantee that one announcement is only
				// ever notified once per alert; ignoring the conflict makes re-running safe.
				.orIgnore()
				.execute();

			// `orIgnore` returns a hole for each row the unique constraint rejected, so this is
			// exactly the matches that are new — and therefore exactly what to email about.
			for (const identifier of result.identifiers) {
				if (identifier?.id) createdIds.push(String(identifier.id));
			}
		}

		if (createdIds.length > 0) {
			this.logger.log(
				`Created ${createdIds.length} alert match(es) across ${jobs.length} announcement(s)`
			);
		}

		return createdIds;
	}

	/**
	 * Every active alert this announcement satisfies.
	 *
	 * Filters are OR *within* a dimension and AND *across* them, and an empty array means the
	 * user placed no constraint on that dimension at all.
	 */
	async findMatchingAlerts(job: Job): Promise<JobAlert[]> {
		return (
			this.jobAlertRepository
				.createQueryBuilder("alert")
				.where("alert.is_active = true")
				// An alert never hears about announcements discovered before it existed, or while
				// it was paused — otherwise creating one would email the whole back catalogue.
				.andWhere("alert.match_from <= :firstSeenAt", {
					firstSeenAt: job.firstSeenAt,
				})
				.andWhere(
					`(
					cardinality(alert.keywords) = 0
					OR EXISTS (
						SELECT 1 FROM unnest(alert.keywords) AS keyword
						WHERE :haystack ILIKE '%' || replace(replace(replace(keyword, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
					)
				)`,
					// Substring matching, because Thai has no word boundaries: the spec's own
					// example is "นักวิชาการคอมพิวเตอร์" matching "นักวิชาการคอมพิวเตอร์ปฏิบัติการ".
					// Agency is included because keywords are the only free-text an alert has.
					{ haystack: `${job.title}\n${job.agency}` }
				)
				.andWhere(
					// A null position type is "unspecified", not "none" — treated as matching any
					// type filter, the same way an unlisted province is treated as nationwide.
					// Without the null guard, `ARRAY[NULL]` makes the overlap NULL and the whole
					// condition collapses to false.
					"(cardinality(alert.job_types) = 0 OR :jobTypeId::int IS NULL OR alert.job_types && ARRAY[:jobTypeId]::int[])",
					{ jobTypeId: job.jobTypeId }
				)
				.andWhere(
					"(cardinality(alert.educations) = 0 OR alert.educations && :educationIds::int[])",
					{ educationIds: job.educationLevelIds ?? [] }
				)
				.andWhere(
					// Same nationwide rule the jobs API uses: an announcement with no province is
					// open to everyone, so it belongs in every province-filtered alert.
					`(
					cardinality(alert.provinces) = 0
					OR cardinality(:provinceIds::int[]) = 0
					OR alert.provinces && :provinceIds::int[]
				)`,
					{ provinceIds: job.provinceIds ?? [] }
				)
				.getMany()
		);
	}

	/** Used by the escape test; the SQL above inlines the same transformation. */
	static escapeKeyword(value: string): string {
		return escapeLike(value);
	}
}

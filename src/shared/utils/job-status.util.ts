import { JobStatus } from "@/shared/enums/job-status.enum";
import { getLocalDateString, toDateString } from "@/shared/utils/date.util";

export interface JobApplicationPeriod {
	applicationStart: string | Date | null;
	applicationEnd: string | Date | null;
}

/**
 * The single definition of a job's status. The API, the email templates and the admin
 * dashboard all go through here so the answer can never drift between them.
 *
 * A missing start date means "already started"; a missing end date means "no deadline
 * announced", which stays OPEN rather than silently closing a live announcement.
 */
export const resolveJobStatus = (
	job: JobApplicationPeriod,
	today: string = getLocalDateString()
): JobStatus => {
	const start = toDateString(job.applicationStart);
	const end = toDateString(job.applicationEnd);

	if (start && today < start) return JobStatus.UPCOMING;
	if (end && today > end) return JobStatus.CLOSED;
	return JobStatus.OPEN;
};

/**
 * The same rule as SQL, for filtering and sorting inside a query builder.
 * `:today` must be bound to `getLocalDateString()`.
 */
export const jobStatusSqlExpression = (alias: string): string => `
	CASE
		WHEN ${alias}.application_start IS NOT NULL AND :today < ${alias}.application_start
			THEN '${JobStatus.UPCOMING}'
		WHEN ${alias}.application_end IS NOT NULL AND :today > ${alias}.application_end
			THEN '${JobStatus.CLOSED}'
		ELSE '${JobStatus.OPEN}'
	END`;

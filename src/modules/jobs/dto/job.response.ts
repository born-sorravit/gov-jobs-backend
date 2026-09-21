import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { JobSource } from "@/shared/enums/job-source.enum";
import { JobStatus } from "@/shared/enums/job-status.enum";
import { getLocalDateString } from "@/shared/utils/date.util";
import { resolveJobStatus } from "@/shared/utils/job-status.util";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class JobAttachmentResponse {
	@ApiProperty() id: string;
	@ApiProperty() name: string;
	@ApiProperty() url: string;
	@ApiProperty() type: string;
}

/** What a job card needs. Deliberately excludes the long free-text and the raw payload. */
export class JobSummaryResponse {
	@ApiProperty() id: string;
	@ApiProperty({ enum: JobSource }) source: JobSource;
	@ApiProperty() externalId: string;
	@ApiProperty() title: string;
	@ApiProperty() agency: string;
	@ApiPropertyOptional() ministry: string | null;
	@ApiPropertyOptional() agencySealUrl: string | null;
	@ApiPropertyOptional() jobCategoryId: number | null;
	@ApiPropertyOptional() jobTypeId: number | null;
	@ApiProperty({ type: [Number] }) provinceIds: number[];
	@ApiProperty({ type: [Number] }) educationLevelIds: number[];

	/**
	 * The source listed no province. That means the posting is nationwide rather than
	 * unknown, so it is returned by every province filter — the card needs to say so, or the
	 * filter looks broken.
	 */
	@ApiProperty() isNationwide: boolean;

	@ApiPropertyOptional() salaryMin: number | null;
	@ApiPropertyOptional() salaryMax: number | null;
	@ApiPropertyOptional() positionAmount: number | null;
	@ApiPropertyOptional() applicationStart: string | null;
	@ApiPropertyOptional() applicationEnd: string | null;
	@ApiPropertyOptional() publishedAt: string | null;
	@ApiProperty({ enum: JobStatus }) status: JobStatus;

	/** Days until the deadline: 0 is the last day, negative has passed, null has no deadline. */
	@ApiPropertyOptional() daysUntilDeadline: number | null;

	@ApiProperty() sourceUrl: string;
}

export class JobDetailResponse extends JobSummaryResponse {
	@ApiPropertyOptional() jobLevelId: number | null;
	@ApiPropertyOptional() jobSelectionId: number | null;
	@ApiPropertyOptional() jobConditionId: number | null;
	@ApiPropertyOptional() jobConditionOther: string | null;
	@ApiPropertyOptional() educationLevelOther: string | null;
	@ApiPropertyOptional() description: string | null;
	@ApiPropertyOptional() educationRequirements: string | null;
	@ApiPropertyOptional() knowledge: string | null;
	@ApiPropertyOptional() skill: string | null;
	@ApiPropertyOptional() competency: string | null;
	@ApiPropertyOptional() criteria: string | null;
	@ApiPropertyOptional() examDate: string | null;
	@ApiPropertyOptional() interviewDate: string | null;
	@ApiPropertyOptional() applyUrl: string | null;
	@ApiProperty({ type: [JobAttachmentResponse] })
	attachments: JobAttachmentResponse[];
}

const daysUntil = (deadline: string | null, today: string): number | null => {
	if (!deadline) return null;
	const end = Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`);
	const now = Date.parse(`${today}T00:00:00Z`);
	if (Number.isNaN(end) || Number.isNaN(now)) return null;
	return Math.round((end - now) / 86_400_000);
};

/**
 * `today` is passed in rather than read per row so every job in a page is judged against the
 * same instant — otherwise a request spanning midnight in Bangkok could return two jobs with
 * contradictory statuses.
 */
export const toJobSummary = (
	job: Job,
	today: string = getLocalDateString()
): JobSummaryResponse => ({
	id: job.id,
	source: job.source,
	externalId: job.externalId,
	title: job.title,
	agency: job.agency,
	ministry: job.ministry,
	agencySealUrl: job.agencySealUrl,
	jobCategoryId: job.jobCategoryId,
	jobTypeId: job.jobTypeId,
	provinceIds: job.provinceIds ?? [],
	educationLevelIds: job.educationLevelIds ?? [],
	isNationwide: (job.provinceIds ?? []).length === 0,
	salaryMin: job.salaryMin,
	salaryMax: job.salaryMax,
	positionAmount: job.positionAmount,
	applicationStart: job.applicationStart,
	applicationEnd: job.applicationEnd,
	publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
	status: resolveJobStatus(job, today),
	daysUntilDeadline: daysUntil(job.applicationEnd, today),
	sourceUrl: job.sourceUrl,
});

const toAttachment = (attachment: JobAttachment): JobAttachmentResponse => ({
	id: attachment.id,
	name: attachment.name,
	url: attachment.url,
	type: attachment.type,
});

export const toJobDetail = (
	job: Job,
	today: string = getLocalDateString()
): JobDetailResponse => ({
	...toJobSummary(job, today),
	jobLevelId: job.jobLevelId,
	jobSelectionId: job.jobSelectionId,
	jobConditionId: job.jobConditionId,
	jobConditionOther: job.jobConditionOther,
	educationLevelOther: job.educationLevelOther,
	description: job.description,
	educationRequirements: job.educationRequirements,
	knowledge: job.knowledge,
	skill: job.skill,
	competency: job.competency,
	criteria: job.criteria,
	examDate: job.examDate,
	interviewDate: job.interviewDate,
	applyUrl: job.applyUrl,
	attachments: (job.attachments ?? []).map(toAttachment),
});

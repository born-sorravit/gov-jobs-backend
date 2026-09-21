/**
 * The OCSC list payload, exactly as `GET /portal/jobs` returns it.
 *
 * Everything is optional on purpose: this is an external contract nobody owes us stability
 * on, so the normaliser validates rather than trusts. Field provenance is in
 * `docs/ocsc-source.md`; a captured snapshot is in `test/fixtures/ocsc-jobs.fixture.json`.
 */
export interface OcscRawJob {
	id?: number;
	seal?: string | null;
	departmentId?: number | null;
	department?: string | null;
	ministry?: string | null;
	jobCategoryId?: number | null;
	jobCategoryOther?: string | null;
	jobSelectionId?: number | null;
	jobSelectionOther?: string | null;
	jobConditionId?: number | null;
	jobConditionOther?: string | null;
	applicationStart?: string | null;
	applicationEnd?: string | null;
	url?: string | null;
	fileName?: string | null;
	position?: string | null;
	jobTypeId?: number | null;
	jobTypeOther?: string | null;
	jobLevelId?: number | null;
	jobLevelOther?: string | null;
	provinceIds?: number[] | null;
	salaryMin?: number | null;
	salaryMax?: number | null;
	positionAmount?: number | null;
	educationLevelIds?: number[] | null;
	educationLevelOther?: string | null;

	// Civil-servant announcements (jobCategoryId 1 and 99) fill this block.
	civilJobEducation?: string | null;
	civilJobDescription?: string | null;
	civilJobKnowledge?: string | null;
	civilJobSkill?: string | null;

	// Government-employee announcements (jobCategoryId 2) fill this one instead.
	employeeJobSpecification?: string | null;
	employeeJobDescription?: string | null;
	employeeJobKnowledge1?: string | null;
	employeeJobKnowledge2?: string | null;
	employeeJobSkill1?: string | null;
	employeeJobSkill2?: string | null;
	employeeJobCompetency1?: string | null;
	employeeJobCompetency2?: string | null;
	employeeJobCriteria?: string | null;

	createDate?: string | null;
	examDate?: string | null;
	interviewDate?: string | null;

	// View counters: they change on literally every request, so they are excluded from the
	// content hash and never stored.
	webView?: number;
	webShare?: number;
	mobileView?: number;
	mobileShare?: number;

	[key: string]: unknown;
}

export interface OcscRawReferenceRow {
	id: number;
	[label: string]: unknown;
}

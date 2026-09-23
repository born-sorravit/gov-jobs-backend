import {
	NormalizedAttachment,
	NormalizedJob,
} from "@/modules/crawler/interfaces/job-source-crawler.interface";
import {
	JobValidationError,
	computeContentHash,
	normalizeJobText,
} from "@/modules/crawler/normalization";
import { OcscRawJob } from "@/modules/crawler/ocsc/ocsc.types";
import { JobSource } from "@/shared/enums/job-source.enum";
import { parseBangkokTimestamp, toDateString } from "@/shared/utils/date.util";

const text = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
};

/**
 * Joins the numbered halves OCSC splits employee fields into.
 *
 * Empty halves are dropped, and so are exact repeats of a half already taken: the portal
 * fills both `employeeJobSkill1` and `employeeJobSkill2` with the same sentence on 34 of
 * the 34 announcements that use them, and joining blindly renders it twice.
 *
 * Deduplication compares against what has already been kept rather than collapsing the
 * whole list, so the handful of announcements whose halves genuinely differ keep both, in
 * the order the source published them.
 */
const joinText = (...values: unknown[]): string | null => {
	const parts: string[] = [];

	for (const value of values) {
		const part = text(value);
		if (part !== null && !parts.includes(part)) {
			parts.push(part);
		}
	}

	return parts.length > 0 ? parts.join("\n") : null;
};

const int = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number.parseInt(value, 10);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
};

const intArray = (value: unknown): number[] => {
	if (!Array.isArray(value)) return [];
	return value
		.map(int)
		.filter((entry): entry is number => entry !== null)
		.sort((a, b) => a - b);
};

export interface OcscNormalizerOptions {
	/** Public portal base, e.g. `https://job.ocsc.go.th/portal`. */
	portalBaseUrl: string;
}

/**
 * Maps one OCSC announcement onto our schema.
 *
 * Pure and synchronous so the whole mapping is testable against the captured fixture with
 * no network. Throws `JobValidationError` for an announcement that cannot be used at all;
 * the caller records it as rejected and carries on with the rest.
 */
export const normalizeOcscJob = (
	raw: OcscRawJob,
	options: OcscNormalizerOptions
): NormalizedJob => {
	const externalId = int(raw.id);
	if (externalId === null) {
		throw new JobValidationError("missing id");
	}

	const title = text(raw.position);
	if (!title) {
		throw new JobValidationError("missing position");
	}

	const agency = text(raw.department);
	if (!agency) {
		throw new JobValidationError("missing department");
	}

	// Civil-servant announcements (category 1 and 99) fill the civilJob* block; government
	// employees (category 2) fill employeeJob*. No announcement fills both, so taking
	// whichever is present keeps one column meaningful for every category.
	const educationRequirements =
		text(raw.civilJobEducation) ?? text(raw.employeeJobSpecification);
	const description =
		text(raw.civilJobDescription) ?? text(raw.employeeJobDescription);
	const knowledge =
		text(raw.civilJobKnowledge) ??
		joinText(raw.employeeJobKnowledge1, raw.employeeJobKnowledge2);
	const skill =
		text(raw.civilJobSkill) ??
		joinText(raw.employeeJobSkill1, raw.employeeJobSkill2);

	const attachments: NormalizedAttachment[] = [];
	const fileName = text(raw.fileName);
	if (fileName) {
		attachments.push({
			name: "ประกาศรับสมัคร",
			url: fileName,
			type: fileName.toLowerCase().endsWith(".pdf") ? "ANNOUNCEMENT_PDF" : "OTHER",
		});
	}

	const withoutHash: Omit<NormalizedJob, "contentHash"> = {
		source: JobSource.OCSC,
		externalId: String(externalId),
		title,
		agency,
		ministry: text(raw.ministry),
		agencyExternalId: int(raw.departmentId),
		agencySealUrl: text(raw.seal),
		jobCategoryId: int(raw.jobCategoryId),
		jobCategoryOther: text(raw.jobCategoryOther),
		jobTypeId: int(raw.jobTypeId),
		jobTypeOther: text(raw.jobTypeOther),
		jobLevelId: int(raw.jobLevelId),
		jobLevelOther: text(raw.jobLevelOther),
		jobSelectionId: int(raw.jobSelectionId),
		jobSelectionOther: text(raw.jobSelectionOther),
		jobConditionId: int(raw.jobConditionId),
		jobConditionOther: text(raw.jobConditionOther),
		provinceIds: intArray(raw.provinceIds),
		educationLevelIds: intArray(raw.educationLevelIds),
		educationLevelOther: text(raw.educationLevelOther),
		description,
		educationRequirements,
		knowledge,
		skill,
		competency: joinText(raw.employeeJobCompetency1, raw.employeeJobCompetency2),
		criteria: text(raw.employeeJobCriteria),
		salaryMin: int(raw.salaryMin),
		salaryMax: int(raw.salaryMax),
		positionAmount: int(raw.positionAmount),
		applicationStart: toDateString(text(raw.applicationStart)),
		applicationEnd: toDateString(text(raw.applicationEnd)),
		examDate: toDateString(text(raw.examDate)),
		interviewDate: toDateString(text(raw.interviewDate)),
		publishedAt: parseBangkokTimestamp(text(raw.createDate)),
		// The human page, so a user can always verify the original announcement. Never the
		// jobapi URL, which is an implementation detail of the portal.
		sourceUrl: `${options.portalBaseUrl.replace(/\/$/, "")}/jobs/${externalId}`,
		// Where applications are actually submitted — usually a third-party site.
		applyUrl: text(raw.url),
		rawPayload: raw as Record<string, unknown>,
		attachments,
	};

	// Canonical Thai before hashing, so the hash describes the text that is stored and a
	// keyword matches whichever way the source happened to spell it.
	const normalized = normalizeJobText(withoutHash);
	return { ...normalized, contentHash: computeContentHash(normalized) };
};

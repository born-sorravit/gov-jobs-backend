import {
	ReferenceItem,
	ReferenceKind,
} from "@/models/reference/entities/reference-item.entity";
import { REFERENCE_EN } from "@/shared/database/seeds/reference.data";
import { JobSource } from "@/shared/enums/job-source.enum";
import { DataSource } from "typeorm";

/** Which OCSC lookup endpoint feeds which taxonomy, and where its Thai label lives. */
export const OCSC_REFERENCE_ENDPOINTS: {
	kind: ReferenceKind;
	path: string;
	labelField: string;
}[] = [
	{ kind: ReferenceKind.PROVINCE, path: "/provinces", labelField: "province" },
	{
		kind: ReferenceKind.EDUCATION_LEVEL,
		path: "/educationlevels",
		labelField: "educationLevel",
	},
	{ kind: ReferenceKind.JOB_TYPE, path: "/jobtypes", labelField: "jobType" },
	{
		kind: ReferenceKind.JOB_CATEGORY,
		path: "/jobcategories",
		labelField: "jobCategory",
	},
	{ kind: ReferenceKind.JOB_LEVEL, path: "/joblevels", labelField: "jobLevel" },
	{
		kind: ReferenceKind.JOB_SELECTION,
		path: "/jobselections",
		labelField: "jobSelection",
	},
	{
		kind: ReferenceKind.JOB_CONDITION,
		path: "/jobconditions",
		labelField: "jobCondition",
	},
];

export interface RawReferenceRow {
	id: number;
	[label: string]: unknown;
}

export const toReferenceItems = (
	kind: ReferenceKind,
	labelField: string,
	rows: RawReferenceRow[],
	source: JobSource = JobSource.OCSC
): ReferenceItem[] =>
	rows.map((row, index) => {
		const item = new ReferenceItem();
		item.source = source;
		item.kind = kind;
		item.externalId = row.id;
		item.nameTh = String(row[labelField] ?? "").trim();
		item.nameEn = REFERENCE_EN[kind]?.[row.id] ?? null;
		item.sortOrder = index;
		return item;
	});

/**
 * Upserts taxonomy rows.
 *
 * `nameEn` is deliberately in the overwrite list: the translation table is ours and should
 * win on every run. Re-running the seed after adding a translation fills it in.
 */
export const upsertReferenceItems = async (
	dataSource: DataSource,
	items: ReferenceItem[]
): Promise<number> => {
	if (items.length === 0) return 0;

	await dataSource.getRepository(ReferenceItem).upsert(items, {
		conflictPaths: ["source", "kind", "externalId"],
		skipUpdateIfNoValuesChanged: true,
	});

	return items.length;
};

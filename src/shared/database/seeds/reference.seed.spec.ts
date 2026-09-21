import { ReferenceKind } from "@/models/reference/entities/reference-item.entity";
import { REFERENCE_EN } from "@/shared/database/seeds/reference.data";
import {
	OCSC_REFERENCE_ENDPOINTS,
	RawReferenceRow,
	toReferenceItems,
} from "@/shared/database/seeds/reference.seed";
import { JobSource } from "@/shared/enums/job-source.enum";
import * as fs from "node:fs";
import * as path from "node:path";

const fixture = (name: string): RawReferenceRow[] =>
	JSON.parse(
		fs.readFileSync(path.join(__dirname, "../../../../test/fixtures", name), "utf8")
	) as RawReferenceRow[];

describe("toReferenceItems", () => {
	it("maps an OCSC province row onto a ReferenceItem", () => {
		const [item] = toReferenceItems(ReferenceKind.PROVINCE, "province", [
			{ id: 2, province: "กรุงเทพมหานคร" },
		]);

		expect(item).toMatchObject({
			source: JobSource.OCSC,
			kind: ReferenceKind.PROVINCE,
			externalId: 2,
			nameTh: "กรุงเทพมหานคร",
			nameEn: "Bangkok",
			sortOrder: 0,
		});
	});

	it("leaves nameEn null when we have no translation for an id", () => {
		const [item] = toReferenceItems(ReferenceKind.PROVINCE, "province", [
			{ id: 9999, province: "จังหวัดใหม่" },
		]);

		expect(item.nameEn).toBeNull();
	});

	it("preserves source order so the UI lists provinces the way the portal does", () => {
		const items = toReferenceItems(
			ReferenceKind.PROVINCE,
			"province",
			fixture("ocsc-provinces.fixture.json")
		);

		expect(items.map((item) => item.sortOrder)).toEqual(
			items.map((_, index) => index)
		);
		expect(items[0].nameTh).toBe("กระบี่");
	});
});

describe("REFERENCE_EN coverage", () => {
	const fixtures: Record<ReferenceKind, string> = {
		[ReferenceKind.PROVINCE]: "ocsc-provinces.fixture.json",
		[ReferenceKind.EDUCATION_LEVEL]: "ocsc-educationlevels.fixture.json",
		[ReferenceKind.JOB_TYPE]: "ocsc-jobtypes.fixture.json",
		[ReferenceKind.JOB_CATEGORY]: "ocsc-jobcategories.fixture.json",
		[ReferenceKind.JOB_LEVEL]: "ocsc-joblevels.fixture.json",
		[ReferenceKind.JOB_SELECTION]: "ocsc-jobselections.fixture.json",
		[ReferenceKind.JOB_CONDITION]: "ocsc-jobconditions.fixture.json",
	};

	it.each(OCSC_REFERENCE_ENDPOINTS)(
		"translates every $kind id the source publishes",
		({ kind, labelField }) => {
			const rows = fixture(fixtures[kind]);
			const items = toReferenceItems(kind, labelField, rows);
			const untranslated = items
				.filter((item) => item.nameEn === null)
				.map((item) => item.externalId);

			expect(untranslated).toEqual([]);
			expect(Object.keys(REFERENCE_EN[kind]).length).toBeGreaterThanOrEqual(
				rows.length
			);
		}
	);
});

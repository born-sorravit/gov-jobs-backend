import { parseThaiDate } from "@/shared/utils/date.util";

describe("parseThaiDate", () => {
	it("reads an abbreviated month, as the listings write it", () => {
		expect(parseThaiDate("22 ก.ย. 2569")).toBe("2026-09-22");
	});

	it("reads a full month, as announcement bodies write it", () => {
		expect(parseThaiDate("2 กันยายน 2569")).toBe("2026-09-02");
	});

	it.each([
		["31 ส.ค. 2569", "2026-08-31"],
		["1 ม.ค. 2568", "2025-01-01"],
		["15 ธ.ค. 2570", "2027-12-15"],
		["29 ก.พ. 2567", "2024-02-29"],
	])("converts %s", (input, expected) => {
		expect(parseThaiDate(input)).toBe(expected);
	});

	it("finds the date inside surrounding text", () => {
		expect(parseThaiDate("เผยแพร่เมื่อ 18 ก.ย. 2569 เวลา 09:00 น.")).toBe("2026-09-18");
	});

	/**
	 * Portals are inconsistent — some print a Gregorian year in an otherwise Thai date.
	 * Subtracting 543 unconditionally would move those back five centuries.
	 */
	it("leaves a Gregorian year alone", () => {
		expect(parseThaiDate("18 ก.ย. 2026")).toBe("2026-09-18");
	});

	it("rejects a day that does not exist in that month", () => {
		expect(parseThaiDate("31 ก.พ. 2569")).toBeNull();
		expect(parseThaiDate("31 เม.ย. 2569")).toBeNull();
	});

	it.each([
		["", "empty"],
		["ไม่ระบุ", "no date at all"],
		["22 Sept 2026", "an English month"],
		["2026-09-22", "an ISO date"],
	])("returns null for %s (%s)", (input) => {
		expect(parseThaiDate(input)).toBeNull();
	});

	it("returns null rather than throwing for null and undefined", () => {
		expect(parseThaiDate(null)).toBeNull();
		expect(parseThaiDate(undefined)).toBeNull();
	});
});

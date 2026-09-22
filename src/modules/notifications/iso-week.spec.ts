import { isoWeekKey } from "@/modules/notifications/notification-dispatch.service";

/**
 * The weekly digest's period key, which is the only thing stopping a second digest going out
 * in the same week. ISO weeks run Monday–Sunday and belong to the year containing their
 * Thursday, which is what makes the year boundary interesting.
 */
describe("isoWeekKey", () => {
	it.each([
		["2026-01-05", "2026-W02", "a plain Monday"],
		["2026-09-22", "2026-W39", "a plain Tuesday"],
		// 1 Jan 2027 is a Friday, so its week's Thursday is 31 Dec 2026 — week 53 of *2026*.
		[
			"2027-01-01",
			"2026-W53",
			"a January date belonging to the previous year's last week",
		],
		["2026-12-31", "2026-W53", "the last day of the year"],
		// 4 Jan 2027 is the Monday that starts 2027's first week.
		["2027-01-04", "2027-W01", "the first Monday of the new year"],
	])("%s -> %s (%s)", (input, expected) => {
		expect(isoWeekKey(new Date(`${input}T00:00:00Z`))).toBe(expected);
	});

	it("gives every day of one week the same key", () => {
		const keys = ["2026-09-21", "2026-09-23", "2026-09-27"].map((day) =>
			isoWeekKey(new Date(`${day}T12:00:00Z`))
		);
		expect(new Set(keys).size).toBe(1);
	});

	it("changes key across a Monday boundary", () => {
		// Sunday and the Monday after belong to different weeks.
		expect(isoWeekKey(new Date("2026-09-27T00:00:00Z"))).not.toBe(
			isoWeekKey(new Date("2026-09-28T00:00:00Z"))
		);
	});
});

import { JobStatus } from "@/shared/enums/job-status.enum";
import { getLocalDateString, parseBangkokTimestamp } from "@/shared/utils/date.util";
import { resolveJobStatus } from "@/shared/utils/job-status.util";

describe("resolveJobStatus", () => {
	const today = "2026-10-10";

	it("is UPCOMING before the application period opens", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: "2026-10-11", applicationEnd: "2026-10-26" },
				today
			)
		).toBe(JobStatus.UPCOMING);
	});

	it("is OPEN on the first day", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: "2026-10-10", applicationEnd: "2026-10-26" },
				today
			)
		).toBe(JobStatus.OPEN);
	});

	it("is OPEN on the last day — the deadline is inclusive", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: "2026-10-01", applicationEnd: "2026-10-10" },
				today
			)
		).toBe(JobStatus.OPEN);
	});

	it("is CLOSED the day after the deadline", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: "2026-10-01", applicationEnd: "2026-10-09" },
				today
			)
		).toBe(JobStatus.CLOSED);
	});

	it("treats a missing start date as already started", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: null, applicationEnd: "2026-10-26" },
				today
			)
		).toBe(JobStatus.OPEN);
	});

	it("keeps an announcement with no deadline OPEN rather than closing it", () => {
		expect(
			resolveJobStatus(
				{ applicationStart: "2026-10-01", applicationEnd: null },
				today
			)
		).toBe(JobStatus.OPEN);
	});

	it("is OPEN when the source published no dates at all", () => {
		expect(
			resolveJobStatus({ applicationStart: null, applicationEnd: null }, today)
		).toBe(JobStatus.OPEN);
	});

	it("accepts Date objects as well as YYYY-MM-DD strings", () => {
		expect(
			resolveJobStatus(
				{
					applicationStart: new Date("2026-10-01"),
					applicationEnd: new Date("2026-10-26"),
				},
				today
			)
		).toBe(JobStatus.OPEN);
	});
});

describe("getLocalDateString", () => {
	it("resolves 'today' in Bangkok, not on the host's clock", () => {
		// 23:30 UTC on 9 Oct is already 06:30 on 10 Oct in Bangkok.
		const instant = new Date("2026-10-09T23:30:00Z");
		expect(getLocalDateString(instant)).toBe("2026-10-10");
		expect(getLocalDateString(instant, "UTC")).toBe("2026-10-09");
	});

	it("does not roll the date forward too early", () => {
		// 16:59 UTC is 23:59 the same day in Bangkok.
		expect(getLocalDateString(new Date("2026-10-09T16:59:00Z"))).toBe("2026-10-09");
		// 17:00 UTC is 00:00 the next day.
		expect(getLocalDateString(new Date("2026-10-09T17:00:00Z"))).toBe("2026-10-10");
	});
});

describe("parseBangkokTimestamp", () => {
	it("reads a naive OCSC timestamp as Bangkok wall-clock time", () => {
		expect(parseBangkokTimestamp("2026-09-21T15:06:09")?.toISOString()).toBe(
			"2026-09-21T08:06:09.000Z"
		);
	});

	it("respects an explicit offset when the source ever sends one", () => {
		expect(parseBangkokTimestamp("2026-09-21T15:06:09Z")?.toISOString()).toBe(
			"2026-09-21T15:06:09.000Z"
		);
	});

	it("returns null for empty or unparseable input", () => {
		expect(parseBangkokTimestamp(null)).toBeNull();
		expect(parseBangkokTimestamp("")).toBeNull();
		expect(parseBangkokTimestamp("not a date")).toBeNull();
	});
});

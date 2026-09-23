export const BANGKOK_TIME_ZONE = "Asia/Bangkok";

/**
 * The calendar date *in Bangkok* as `YYYY-MM-DD`.
 *
 * OCSC ships `application_start` / `application_end` as naive dates with no timezone, so
 * "today" has to be resolved in Thai local time. Using the server's own date would flip
 * UPCOMING/OPEN/CLOSED up to 7 hours early on a UTC host.
 */
export const getLocalDateString = (
	date: Date = new Date(),
	timeZone: string = BANGKOK_TIME_ZONE
): string =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);

/** Parses `YYYY-MM-DD` (or a Date) into a `YYYY-MM-DD` string, or null when unusable. */
export const toDateString = (
	value: string | Date | null | undefined
): string | null => {
	if (!value) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
	}
	const trimmed = value.trim();
	if (!trimmed) return null;
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
	return match ? match[1] : null;
};

/**
 * Parses a naive OCSC timestamp (`2026-09-21T15:06:09`, no offset) as Bangkok wall-clock
 * time. Thailand has a fixed +07:00 offset and observes no DST, so appending it is exact.
 */
export const parseBangkokTimestamp = (
	value: string | null | undefined
): Date | null => {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
	const parsed = new Date(hasZone ? trimmed : `${trimmed}+07:00`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * A date as a reader expects to see it, for email bodies.
 *
 * Thai uses the Buddhist era, which `th-TH-u-ca-buddhist` produces directly — the same rule
 * the frontend applies, kept identical so an email and the site never disagree about a
 * deadline.
 */
export const formatDate = (
	value: string | Date | null | undefined,
	locale: "th" | "en" = "th"
): string => {
	if (!value) return "—";
	const date =
		typeof value === "string"
			? new Date(`${value.slice(0, 10)}T00:00:00+07:00`)
			: value;
	if (Number.isNaN(date.getTime())) return "—";

	return new Intl.DateTimeFormat(locale === "th" ? "th-TH-u-ca-buddhist" : "en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: BANGKOK_TIME_ZONE,
	}).format(date);
};

/**
 * Thai month names, abbreviated and full, in calendar order.
 *
 * Both spellings occur in the wild — listings abbreviate (`22 ก.ย. 2569`) while the
 * announcement body usually does not (`22 กันยายน 2569`) — so both are matched here rather
 * than in each parser.
 */
const THAI_MONTHS = [
	["ม.ค.", "มกราคม"],
	["ก.พ.", "กุมภาพันธ์"],
	["มี.ค.", "มีนาคม"],
	["เม.ย.", "เมษายน"],
	["พ.ค.", "พฤษภาคม"],
	["มิ.ย.", "มิถุนายน"],
	["ก.ค.", "กรกฎาคม"],
	["ส.ค.", "สิงหาคม"],
	["ก.ย.", "กันยายน"],
	["ต.ค.", "ตุลาคม"],
	["พ.ย.", "พฤศจิกายน"],
	["ธ.ค.", "ธันวาคม"],
] as const;

/** Buddhist era runs 543 years ahead of the Gregorian one. */
const BUDDHIST_ERA_OFFSET = 543;

/**
 * Parses a Thai-language date (`22 ก.ย. 2569`, `2 กันยายน 2569`) into `YYYY-MM-DD`.
 *
 * Returns null rather than guessing: a caller that cannot read the date should record the
 * announcement without one, not with a wrong one.
 *
 * The year is treated as Buddhist era only when it is large enough to be one. Portals are
 * inconsistent — some publish `2026` in an otherwise Thai date — and subtracting 543 from a
 * year that was already Gregorian would silently move the announcement back five centuries.
 */
export const parseThaiDate = (value: string | null | undefined): string | null => {
	if (!value) return null;

	const match = /(\d{1,2})\s*([ก-ฮ][ก-ฮ.ะ-๎]*)\s*(\d{4})/.exec(value);
	if (!match) return null;

	const [, dayText, monthText, yearText] = match;

	const monthIndex = THAI_MONTHS.findIndex((names) =>
		names.some((name) => name === monthText)
	);
	if (monthIndex === -1) return null;

	const day = Number.parseInt(dayText, 10);
	const rawYear = Number.parseInt(yearText, 10);
	const year = rawYear >= 2400 ? rawYear - BUDDHIST_ERA_OFFSET : rawYear;

	// Round-tripped through Date so an impossible day (31 กุมภาพันธ์) is rejected rather than
	// rolling over into the next month.
	const date = new Date(Date.UTC(year, monthIndex, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== monthIndex ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	return date.toISOString().slice(0, 10);
};

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

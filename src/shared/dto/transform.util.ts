import { TransformFnParams } from "class-transformer";

/**
 * Normalises a repeated or comma-separated query parameter into a number array.
 *
 * Express gives `?province=1&province=2` as `["1","2"]` but `?province=1` as `"1"`, and the
 * frontend may send `?province=1,2`. All three have to reach the DTO as `number[]`, or a
 * single-select filter behaves differently from a multi-select one.
 */
export const toNumberArray = ({
	value,
}: TransformFnParams): number[] | undefined => {
	if (value === undefined || value === null || value === "") return undefined;

	const raw = Array.isArray(value) ? value : [value];
	const parsed = raw
		.flatMap((entry) => String(entry).split(","))
		.map((entry) => Number.parseInt(entry.trim(), 10))
		.filter((entry) => !Number.isNaN(entry));

	return parsed.length > 0 ? [...new Set(parsed)] : undefined;
};

/** `?flag=true` / `?flag=1` -> true. Anything else falsy, so an absent flag never blocks. */
export const toBoolean = ({ value }: TransformFnParams): boolean | undefined => {
	if (value === undefined || value === null || value === "") return undefined;
	return value === true || value === "true" || value === "1";
};

/** Collapses a blank or whitespace-only search box to `undefined` rather than matching "". */
export const toTrimmedString = ({
	value,
}: TransformFnParams): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

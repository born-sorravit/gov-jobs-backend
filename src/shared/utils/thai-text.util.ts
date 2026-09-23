/**
 * THAI CHARACTER SARA AM (ำ) and the two-codepoint spelling of it.
 *
 * `ำ` has **no canonical decomposition**, so `String.normalize()` in any form leaves the
 * two-codepoint spelling alone — this has to be an explicit substitution.
 */
const SARA_AM = "ำ";
const NIKHAHIT = "ํ";
const SARA_AA = "า";

/** The tone marks and the thanthakhat, which may sit between the two halves. */
const TONE_MARKS = "่-์";

/**
 * `ํ` + `า` written as two codepoints, optionally with a tone mark caught in the middle.
 *
 * The tone is captured and re-emitted *before* the composed vowel, which is the order Thai
 * text is normally stored in — otherwise the substitution would fix the vowel and leave the
 * tone somewhere a comparison still would not match.
 */
const DECOMPOSED_SARA_AM = new RegExp(
	`${NIKHAHIT}([${TONE_MARKS}]?)${SARA_AA}`,
	"g"
);

/**
 * Thai combining marks as the Private Use Area encodes them.
 *
 * Thai PDFs are routinely produced with fonts that place tone marks and vowels at PUA
 * codepoints (U+F700–U+F71A) so the glyph sits at the right height above a tall consonant.
 * A text extractor reads exactly what the font says, so `ตำแหน่ง` comes out as
 * `ตำแหน` + U+F70A + `ง` — a string that looks right and matches nothing.
 *
 * Measured over the announcements extracted so far: 11,435 PUA characters across 11 of 12
 * documents, and `ตำแหน่ง` appears 39 times before this mapping and 533 after it. Without it
 * every Thai word carrying a tone mark is effectively unsearchable.
 */
const PUA_COMBINING_MARKS: Record<number, string> = {
	0xf700: "\u0E4D", // NIKHAHIT
	0xf701: "\u0E48", // MAI EK
	0xf702: "\u0E49", // MAI THO
	0xf703: "\u0E4A", // MAI TRI
	0xf704: "\u0E4B", // MAI CHATTAWA
	0xf705: "\u0E4C", // THANTHAKHAT
	0xf706: "\u0E4D",
	0xf707: "\u0E48",
	0xf708: "\u0E49",
	0xf709: "\u0E4A",
	0xf70a: "\u0E48",
	0xf70b: "\u0E49",
	0xf70c: "\u0E4A",
	0xf70d: "\u0E4B",
	0xf70e: "\u0E4C",
	0xf70f: "\u0E0D", // YO YING, drawn without its lower limb
	0xf710: "\u0E31", // MAI HAN AKAT
	0xf711: "\u0E34", // SARA I
	0xf712: "\u0E35", // SARA II
	0xf713: "\u0E36", // SARA UE
	0xf714: "\u0E37", // SARA UEE
	0xf715: "\u0E48",
	0xf716: "\u0E49",
	0xf717: "\u0E4A",
	0xf718: "\u0E38", // SARA U
	0xf719: "\u0E39", // SARA UU
	0xf71a: "\u0E3A", // PHINTHU
};

/** Only the block the table covers, so unrelated PUA is left alone rather than mangled. */
const PUA_RANGE = /[\uF700-\uF71A]/g;

const restorePuaMarks = (value: string): string =>
	value.replace(
		PUA_RANGE,
		(char) => PUA_COMBINING_MARKS[char.codePointAt(0) as number] ?? char
	);

/**
 * Canonical Thai, for anything that will be compared as text.
 *
 * Thai portals are inconsistent about `ำ`: MDES publishes both spellings **on the same
 * listing page** — 7 of 15 titles use `ํ` + `า`. The two look identical to a reader and are
 * different strings to a database, so an alert whose keyword is `ดำรงตำแหน่ง` silently fails
 * to match half the announcements that plainly contain it.
 *
 * Applied to both sides: source text as it is normalised, and the keywords a user saves. One
 * side alone leaves the mismatch intact for text arriving from the other direction.
 */
export const normalizeThaiText = (value: string): string =>
	restorePuaMarks(value)
		.normalize("NFC")
		.replace(DECOMPOSED_SARA_AM, `$1${SARA_AM}`);

/** The same, for the many fields that are optional. */
export const normalizeThaiTextOrNull = (
	value: string | null | undefined
): string | null => {
	if (value === null || value === undefined) return null;
	const normalized = normalizeThaiText(value);
	return normalized === "" ? null : normalized;
};

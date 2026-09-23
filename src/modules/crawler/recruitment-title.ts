import { normalizeThaiText } from "@/shared/utils/thai-text.util";

/**
 * Titles that mean "applications are open right now".
 *
 * **Positive match, deliberately.** Government sites file recruitment under general HR-news
 * categories that are mostly *not* openings: eligibility lists, results, calls to report for
 * duty, promotion criteria. Every row a crawler keeps is handed to the matching queue and can
 * become an email, so a user searching `นักวิชาการคอมพิวเตอร์` would otherwise be emailed
 * about the results of an exam they never sat.
 *
 * A negative list — excluding `ประกาศรายชื่อ`, `มารายงานตัว`, … — fails *open*: a phrasing
 * nobody anticipated becomes a spurious job and a spurious email. This fails *closed*: an
 * opening we do not recognise is recorded as a skip on the run row, where it can be read and
 * the list widened. Missing one announcement is recoverable; emailing users about non-jobs is
 * what makes them unsubscribe.
 *
 * Internal moves (transfer, promotion selection) are included on purpose: an existing
 * official applies to those exactly as an outsider applies to an open exam. The line is "can
 * a reader apply to this right now?", not "is this open to the public?".
 *
 * Shared across sources because it is about Thai announcement phrasing, not about any one
 * portal. Each source's spec asserts it against that source's own captured titles — measured
 * live, it keeps 3 of 42 DOL titles and 3 of 15 MDES titles, and every one of those six is
 * genuinely open for application.
 */
const RECRUITMENT_TITLE_PATTERNS = [
	"รับสมัครสอบแข่งขัน",
	"รับสมัครสอบคัดเลือก",
	"รับสมัครคัดเลือก",
	"รับสมัครบุคคล",
	"รับสมัครพนักงาน",
	"รับสมัครลูกจ้าง",
	"รับโอน",
	"รับย้าย",
] as const;

/**
 * Normalises before comparing: portals spell `ำ` two ways, and a pattern written one way
 * would silently miss titles written the other. MDES uses both spellings on one page.
 */
export const isRecruitmentAnnouncement = (title: string): boolean => {
	const normalized = normalizeThaiText(title);
	return RECRUITMENT_TITLE_PATTERNS.some((pattern) => normalized.includes(pattern));
};

import { Job } from "@/models/jobs/entities/job.entity";
import { ReferenceItem } from "@/models/reference/entities/reference-item.entity";
import { formatDate } from "@/shared/utils/date.util";

export type EmailLocale = "th" | "en";

export interface JobAlertEmailInput {
	locale: EmailLocale;
	alertName: string;
	jobs: Job[];
	/** Taxonomy labels, keyed `${kind}:${externalId}`. */
	labels: Map<string, ReferenceItem>;
	webUrl: string;
	manageUrl: string;
}

const COPY = {
	th: {
		subjectOne: (title: string) => `${title} — ประกาศใหม่ที่ตรงกับคุณ`,
		subjectMany: (title: string, rest: number) =>
			`${title} และอีก ${rest} ตำแหน่ง — ประกาศใหม่ที่ตรงกับคุณ`,
		intro: (alertName: string, count: number) =>
			`มีประกาศรับสมัครงานราชการ ${count} ตำแหน่งที่ตรงกับการแจ้งเตือน “${alertName}” ของคุณ`,
		agency: "หน่วยงาน",
		jobType: "ประเภทตำแหน่ง",
		education: "วุฒิการศึกษา",
		province: "จังหวัด",
		nationwide: "ทั่วประเทศ",
		period: "ช่วงรับสมัคร",
		salary: "เงินเดือน",
		salaryUnit: "บาท/เดือน",
		viewSource: "ดูประกาศต้นทาง",
		viewOnSite: "ดูรายละเอียดบนเว็บไซต์",
		manage: "จัดการการแจ้งเตือน",
		footer:
			"อีเมลนี้ส่งจากระบบรวบรวมประกาศสาธารณะของสำนักงาน ก.พ. กรุณายึดประกาศต้นฉบับเป็นหลัก",
		unspecified: "ไม่ระบุ",
	},
	en: {
		subjectOne: (title: string) => `${title} — a new matching announcement`,
		subjectMany: (title: string, rest: number) =>
			`${title} and ${rest} more — new matching announcements`,
		intro: (alertName: string, count: number) =>
			`${count} government job announcement(s) match your alert “${alertName}”.`,
		agency: "Agency",
		jobType: "Position type",
		education: "Education",
		province: "Province",
		nationwide: "Nationwide",
		period: "Application period",
		salary: "Salary",
		salaryUnit: "THB / month",
		viewSource: "View the original announcement",
		viewOnSite: "See details on the site",
		manage: "Manage your alerts",
		footer:
			"Compiled from OCSC's public announcements. The original announcement is authoritative.",
		unspecified: "Not specified",
	},
} as const;

/** Minimal escaping — every value here is agency-authored text rendered into HTML. */
const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const label = (
	labels: Map<string, ReferenceItem>,
	kind: string,
	id: number | null,
	locale: EmailLocale
): string | null => {
	if (id === null || id === 0) return null;
	const item = labels.get(`${kind}:${id}`);
	if (!item) return null;
	return locale === "en" ? (item.nameEn ?? item.nameTh) : item.nameTh;
};

const salaryRange = (job: Job, locale: EmailLocale): string | null => {
	if (!job.salaryMin && !job.salaryMax) return null;
	const format = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US");
	if (job.salaryMin && job.salaryMax && job.salaryMin !== job.salaryMax) {
		return `${format.format(job.salaryMin)}–${format.format(job.salaryMax)}`;
	}
	return format.format((job.salaryMin ?? job.salaryMax) as number);
};

/**
 * The subject leads with the **position title**, not the alert name.
 *
 * It is the one line that survives truncation in a notification shade, and the position is
 * what a reader is deciding about.
 */
export const buildSubject = (input: JobAlertEmailInput): string => {
	const copy = COPY[input.locale];
	const [first, ...rest] = input.jobs;
	if (!first) return input.alertName;
	return rest.length === 0
		? copy.subjectOne(first.title)
		: copy.subjectMany(first.title, rest.length);
};

const jobFields = (
	job: Job,
	input: JobAlertEmailInput
): { label: string; value: string }[] => {
	const copy = COPY[input.locale];
	const { labels, locale } = input;

	const provinces = job.provinceIds?.length
		? job.provinceIds
				.map((id) => label(labels, "PROVINCE", id, locale))
				.filter(Boolean)
				.join(", ")
		: copy.nationwide;

	const educations = job.educationLevelIds?.length
		? job.educationLevelIds
				.map((id) => label(labels, "EDUCATION_LEVEL", id, locale))
				.filter(Boolean)
				.join(", ")
		: copy.unspecified;

	const salary = salaryRange(job, locale);

	// Exactly the fields requirement 10 lists, in the order a reader scans them.
	return [
		{
			label: copy.agency,
			value: job.ministry ? `${job.agency} · ${job.ministry}` : job.agency,
		},
		{
			label: copy.jobType,
			value: label(labels, "JOB_TYPE", job.jobTypeId, locale) ?? copy.unspecified,
		},
		{ label: copy.education, value: educations || copy.unspecified },
		{ label: copy.province, value: provinces || copy.unspecified },
		{
			label: copy.period,
			value: `${formatDate(job.applicationStart, locale)} – ${formatDate(job.applicationEnd, locale)}`,
		},
		...(salary
			? [{ label: copy.salary, value: `${salary} ${copy.salaryUnit}` }]
			: []),
	];
};

export const buildText = (input: JobAlertEmailInput): string => {
	const copy = COPY[input.locale];
	const lines: string[] = [copy.intro(input.alertName, input.jobs.length), ""];

	for (const job of input.jobs) {
		lines.push(`■ ${job.title}`);
		for (const field of jobFields(job, input)) {
			lines.push(`  ${field.label}: ${field.value}`);
		}
		// Requirement 7: the original announcement must always be reachable.
		lines.push(`  ${copy.viewSource}: ${job.sourceUrl}`);
		lines.push(`  ${copy.viewOnSite}: ${input.webUrl}/jobs/${job.id}`);
		lines.push("");
	}

	lines.push(`${copy.manage}: ${input.manageUrl}`, "", copy.footer);
	return lines.join("\n");
};

export const buildHtml = (input: JobAlertEmailInput): string => {
	const copy = COPY[input.locale];

	const cards = input.jobs
		.map((job) => {
			const rows = jobFields(job, input)
				.map(
					(field) =>
						`<tr><td style="padding:2px 12px 2px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(field.label)}</td><td style="padding:2px 0;font-size:13px">${escapeHtml(field.value)}</td></tr>`
				)
				.join("");

			return `
			<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px">
				<div style="font-weight:600;font-size:16px;line-height:1.5;margin-bottom:8px">${escapeHtml(job.title)}</div>
				<table style="border-collapse:collapse">${rows}</table>
				<div style="margin-top:12px">
					<a href="${escapeHtml(job.sourceUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-size:13px">${escapeHtml(copy.viewSource)}</a>
					<a href="${escapeHtml(`${input.webUrl}/jobs/${job.id}`)}" style="display:inline-block;color:#4f46e5;text-decoration:none;padding:8px 10px;font-size:13px">${escapeHtml(copy.viewOnSite)}</a>
				</div>
			</div>`;
		})
		.join("");

	// `lang` matters: the content is Thai, and clients pick line-breaking and fallback fonts
	// from it. The font stack names Thai faces first because no email client ships Geist.
	return `<!doctype html>
<html lang="${input.locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f9fafb;font-family:'Noto Sans Thai','Sarabun','Leelawadee UI','Tahoma',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
	<div style="max-width:620px;margin:0 auto">
		<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${escapeHtml(copy.intro(input.alertName, input.jobs.length))}</p>
		${cards}
		<p style="margin:20px 0 0;font-size:13px">
			<a href="${escapeHtml(input.manageUrl)}" style="color:#4f46e5">${escapeHtml(copy.manage)}</a>
		</p>
		<p style="margin:12px 0 0;color:#6b7280;font-size:12px;line-height:1.6">${escapeHtml(copy.footer)}</p>
	</div>
</body>
</html>`;
};

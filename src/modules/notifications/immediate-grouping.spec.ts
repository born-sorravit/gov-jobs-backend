import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { immediateEmailJobId } from "@/constants/queue.constants";
import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";

const ALERT = { id: "alert-1", isActive: true, frequency: AlertFrequency.IMMEDIATE };

const match = (
	id: string,
	jobId: string,
	urls: string[],
	alert = ALERT
): JobAlertMatch =>
	({
		id,
		jobAlertId: alert.id,
		jobAlert: alert,
		jobId,
		job: { id: jobId, attachments: urls.map((url) => ({ url })) },
		notifiedAt: null,
	}) as unknown as JobAlertMatch;

const build = (matches: JobAlertMatch[]) => {
	const addBulk = jest.fn().mockResolvedValue([]);
	const service = new NotificationDispatchService(
		{ addBulk } as never,
		{} as never,
		{ find: async () => matches } as never
	);
	return { service, addBulk };
};

/** The email jobs a dispatch produced, as {matchIds, jobId} pairs. */
const queued = (addBulk: jest.Mock) =>
	(addBulk.mock.calls[0]?.[0] ?? []).map(
		(entry: { data: { matchIds: string[] }; opts: { jobId: string } }) => ({
			matchIds: [...entry.data.matchIds].sort(),
			jobId: entry.opts.jobId,
		})
	);

describe("dispatchImmediate, grouping by announcement", () => {
	const PDF = "https://job.ocsc.go.th/upload2/job-10851.pdf";

	/**
	 * OCSC publishes a multi-position recruitment as one job row per position, all carrying
	 * the same PDF — 7 documents across 38 of 54 rows in the corpus. Three matches used to
	 * mean three emails about one announcement.
	 */
	it("sends one email for several positions of the same announcement", async () => {
		const matches = [
			match("m1", "job-a", [PDF]),
			match("m2", "job-b", [PDF]),
			match("m3", "job-c", [PDF]),
		];
		const { service, addBulk } = build(matches);

		const emails = await service.dispatchImmediate(["m1", "m2", "m3"]);

		expect(emails).toBe(1);
		expect(queued(addBulk)).toEqual([
			{
				matchIds: ["m1", "m2", "m3"],
				jobId: immediateEmailJobId(["m1", "m2", "m3"]),
			},
		]);
	});

	it("keeps separate announcements in separate emails", async () => {
		const other = "https://job.ocsc.go.th/upload2/job-99999.pdf";
		const { service, addBulk } = build([
			match("m1", "job-a", [PDF]),
			match("m2", "job-b", [other]),
		]);

		expect(await service.dispatchImmediate(["m1", "m2"])).toBe(2);
		expect(queued(addBulk)).toHaveLength(2);
	});

	/** Sources that publish one row per announcement have no attachment to group on. */
	it("gives a job with no attachment its own email, as before", async () => {
		const { service, addBulk } = build([
			match("m1", "job-a", []),
			match("m2", "job-b", []),
		]);

		expect(await service.dispatchImmediate(["m1", "m2"])).toBe(2);
		expect(queued(addBulk).map((e: { matchIds: string[] }) => e.matchIds)).toEqual([
			["m1"],
			["m2"],
		]);
	});

	it("never merges two users' alerts, whatever they matched", async () => {
		const otherAlert = { ...ALERT, id: "alert-2" };
		const { service, addBulk } = build([
			match("m1", "job-a", [PDF]),
			match("m2", "job-a", [PDF], otherAlert),
		]);

		expect(await service.dispatchImmediate(["m1", "m2"])).toBe(2);
	});

	/**
	 * Matching runs per announcement at concurrency 4, so the positions of one announcement
	 * routinely arrive in separate dispatch calls. The second call must still send — this is
	 * where a job id keyed on (alert, announcement) rather than on the match set would drop a
	 * notification silently.
	 */
	it("still emails a position that arrives in a later dispatch", async () => {
		const first = build([match("m1", "job-a", [PDF])]);
		await first.service.dispatchImmediate(["m1"]);

		const second = build([match("m2", "job-b", [PDF])]);
		const emails = await second.service.dispatchImmediate(["m2"]);

		expect(emails).toBe(1);
		expect(queued(second.addBulk)[0].jobId).not.toBe(queued(first.addBulk)[0].jobId);
	});

	it("drops a redispatch of the same matches, which is what prevents a double send", async () => {
		const matches = [match("m1", "job-a", [PDF]), match("m2", "job-b", [PDF])];
		const a = build(matches);
		const b = build(matches);

		await a.service.dispatchImmediate(["m1", "m2"]);
		await b.service.dispatchImmediate(["m2", "m1"]);

		// Same id, so BullMQ treats the second as a duplicate and never sends twice.
		expect(queued(b.addBulk)[0].jobId).toBe(queued(a.addBulk)[0].jobId);
	});

	it("leaves digest and paused alerts alone", async () => {
		const digest = { ...ALERT, id: "alert-d", frequency: AlertFrequency.DAILY };
		const paused = { ...ALERT, id: "alert-p", isActive: false };
		const { service } = build([
			match("m1", "job-a", [PDF], digest),
			match("m2", "job-b", [PDF], paused),
		]);

		expect(await service.dispatchImmediate(["m1", "m2"])).toBe(0);
	});
});

describe("immediateEmailJobId", () => {
	it("does not depend on the order the matches came in", () => {
		expect(immediateEmailJobId(["b", "a"])).toBe(immediateEmailJobId(["a", "b"]));
	});

	it("differs for a different set", () => {
		expect(immediateEmailJobId(["a"])).not.toBe(immediateEmailJobId(["a", "b"]));
	});

	/** BullMQ rejects a custom id containing `:` once a queue prefix is configured. */
	it("is safe as a BullMQ custom id", () => {
		expect(immediateEmailJobId(["a", "b"])).not.toContain(":");
		expect(immediateEmailJobId(["a"])).toMatch(/^email--[0-9a-f]{32}$/);
	});
});

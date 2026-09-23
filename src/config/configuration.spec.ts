import configuration from "@/config/configuration";

/**
 * The scheduler's interval was `OCSC_CRAWL_INTERVAL_MINUTES` before it became multi-source.
 * These pin the fallback, because getting it wrong is silent: the crawl keeps running, just
 * on the default interval rather than the configured one.
 */
describe("crawler.intervalMinutes", () => {
	const KEYS = ["CRAWLER_INTERVAL_MINUTES", "OCSC_CRAWL_INTERVAL_MINUTES"] as const;
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
		for (const key of KEYS) delete process.env[key];
	});

	afterEach(() => {
		for (const key of KEYS) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
	});

	const interval = (): number => configuration().crawler.intervalMinutes;

	it("defaults to 60 when neither is set", () => {
		expect(interval()).toBe(60);
	});

	it("reads the current name", () => {
		process.env.CRAWLER_INTERVAL_MINUTES = "15";
		expect(interval()).toBe(15);
	});

	it("falls back to the old name", () => {
		process.env.OCSC_CRAWL_INTERVAL_MINUTES = "30";
		expect(interval()).toBe(30);
	});

	it("prefers the current name when both are set", () => {
		process.env.CRAWLER_INTERVAL_MINUTES = "15";
		process.env.OCSC_CRAWL_INTERVAL_MINUTES = "30";
		expect(interval()).toBe(15);
	});

	/**
	 * A hosting platform declaring a variable with no value hands the process an empty
	 * string, not `undefined` — which `??` would accept, silently discarding the value the
	 * environment actually still carries under the old name.
	 */
	it("treats the current name as unset when it is blank", () => {
		process.env.CRAWLER_INTERVAL_MINUTES = "";
		process.env.OCSC_CRAWL_INTERVAL_MINUTES = "30";
		expect(interval()).toBe(30);
	});
});

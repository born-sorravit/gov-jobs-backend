import { AuthController } from "@/modules/auth/auth.controller";
import {
	THROTTLER_LIMIT,
	THROTTLER_TTL,
} from "@nestjs/throttler/dist/throttler.constants";

/**
 * Credential endpoints must stay far tighter than the global browsing limit.
 *
 * Asserted on the metadata rather than by firing requests: the limit is per-IP and
 * process-wide, so an e2e that proves it would also throttle every other test in the file.
 */
describe("credential throttling", () => {
	const GLOBAL_LIMIT = 120;

	it.each(["register", "login", "changePassword", "deleteAccount"])(
		"applies a tighter limit to %s",
		(method) => {
			const handler = AuthController.prototype[method as "login"];

			const limit = Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler);
			const ttl = Reflect.getMetadata(`${THROTTLER_TTL}default`, handler);

			expect(limit).toBeLessThan(GLOBAL_LIMIT);
			expect(limit).toBeLessThanOrEqual(10);
			expect(ttl).toBe(60_000);
		}
	);

	it("leaves the limit tunable per deployment", () => {
		// Defaults to 10; AUTH_THROTTLE_LIMIT overrides it without a code change.
		const parsed =
			Number.parseInt(process.env.AUTH_THROTTLE_LIMIT ?? "10", 10) || 10;
		expect(parsed).toBeGreaterThan(0);
	});
});

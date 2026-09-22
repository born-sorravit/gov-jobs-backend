/**
 * Runs before the module registry is populated for each e2e file.
 *
 * The credential endpoints allow 10 attempts a minute in production. A suite that registers
 * a dozen accounts would spend most of its assertions on 429s, so the limit is raised here —
 * the tight default is asserted directly in `auth-throttle.spec.ts`.
 */
process.env.AUTH_THROTTLE_LIMIT = process.env.AUTH_THROTTLE_LIMIT ?? "1000";

/**
 * A just-rotated refresh token is normally forgiven for 15s so concurrent browser requests
 * all succeed. The suite asserts both sides of that boundary, so the window is shortened —
 * waiting 15 seconds to prove a replay is rejected would be the slowest test in the project.
 */
process.env.REFRESH_ROTATION_GRACE_MS =
	process.env.REFRESH_ROTATION_GRACE_MS ?? "1000";

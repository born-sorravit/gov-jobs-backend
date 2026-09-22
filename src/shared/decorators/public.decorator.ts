import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opts a route out of the global `JwtAuthGuard`.
 *
 * Authentication is on by default and switched off explicitly, rather than the reverse: a
 * route added later without a guard is then a 401, not an unnoticed hole.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

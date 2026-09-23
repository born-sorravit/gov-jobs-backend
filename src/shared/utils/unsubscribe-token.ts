import { randomBytes } from "node:crypto";

/**
 * A bearer secret that appears in an email and in a URL.
 *
 * 32 bytes from the CSPRNG — the same strength the refresh tokens use, and far past guessing
 * even though the endpoint is public and unauthenticated. `base64url` so it survives a query
 * string, an HTML attribute and a `List-Unsubscribe` header without escaping.
 */
export const newUnsubscribeToken = (): string =>
	randomBytes(32).toString("base64url");

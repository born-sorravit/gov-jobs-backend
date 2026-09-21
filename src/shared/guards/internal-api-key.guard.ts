import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { timingSafeEqual } from "node:crypto";

export const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

/**
 * Protects the endpoints an external scheduler calls.
 *
 * Render's free web service sleeps when idle, so the crawl is driven by an outside cron
 * hitting an HTTP endpoint rather than an in-process timer. That endpoint is therefore
 * publicly reachable and needs a shared secret.
 *
 * A missing or blank `INTERNAL_API_KEY` denies every request rather than allowing them:
 * failing open here would expose the crawl trigger to anyone who guessed the path.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
	constructor(private readonly configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const expected = this.configService.get<string>("security.internalApiKey") ?? "";
		if (expected.trim() === "") {
			throw new UnauthorizedException("Internal API key is not configured");
		}

		const request = context.switchToHttp().getRequest<Request>();
		const header = request.headers[INTERNAL_API_KEY_HEADER];
		const provided = Array.isArray(header) ? header[0] : (header ?? "");

		if (!this.matches(provided, expected)) {
			throw new UnauthorizedException("Invalid internal API key");
		}

		return true;
	}

	/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
	private matches(provided: string, expected: string): boolean {
		const a = Buffer.from(provided);
		const b = Buffer.from(expected);
		if (a.length !== b.length) return false;
		return timingSafeEqual(a, b);
	}
}

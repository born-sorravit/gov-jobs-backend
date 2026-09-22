import {
	AuthSessionResponse,
	AuthUserResponse,
	LoginDto,
	RefreshDto,
	RegisterDto,
} from "@/modules/auth/dto/auth.dto";
import { AuthService } from "@/modules/auth/auth.service";
import { CurrentUser } from "@/shared/decorators/current-user.decorator";
import type { AuthenticatedUser } from "@/shared/decorators/current-user.decorator";
import { Public } from "@/shared/decorators/public.decorator";
import { MessagedResponse } from "@/shared/interceptors/response.interceptor";
import { Body, Controller, Get, Headers, HttpCode, Post } from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

/**
 * Credential endpoints are throttled far tighter than the global limit: 120 requests a
 * minute is reasonable for browsing jobs and absurd for password attempts.
 *
 * Read from the environment at import time because `@Throttle` takes a static object — which
 * also makes the limit tunable per deployment, and lets the e2e suite raise it rather than
 * tripping over its own sign-ups.
 */
const CREDENTIAL_THROTTLE = {
	default: {
		limit: Number.parseInt(process.env.AUTH_THROTTLE_LIMIT ?? "10", 10) || 10,
		ttl: 60_000,
	},
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Public()
	@Throttle(CREDENTIAL_THROTTLE)
	@Post("register")
	@ApiOperation({ summary: "Create an account and start a session" })
	@ApiOkResponse({ type: AuthSessionResponse })
	register(
		@Body() dto: RegisterDto,
		@Headers("user-agent") userAgent?: string
	): Promise<AuthSessionResponse> {
		return this.authService.register(dto, userAgent);
	}

	@Public()
	@Throttle(CREDENTIAL_THROTTLE)
	@Post("login")
	@HttpCode(200)
	@ApiOperation({ summary: "Exchange credentials for a session" })
	@ApiOkResponse({ type: AuthSessionResponse })
	login(
		@Body() dto: LoginDto,
		@Headers("user-agent") userAgent?: string
	): Promise<AuthSessionResponse> {
		return this.authService.login(dto, userAgent);
	}

	@Public()
	@Post("refresh")
	@HttpCode(200)
	@ApiOperation({
		summary: "Rotate a refresh token for a new session",
		description: "The presented token is revoked, so it cannot be replayed.",
	})
	@ApiOkResponse({ type: AuthSessionResponse })
	refresh(
		@Body() dto: RefreshDto,
		@Headers("user-agent") userAgent?: string
	): Promise<AuthSessionResponse> {
		return this.authService.refresh(dto.refreshToken, userAgent);
	}

	@Public()
	@Post("logout")
	@HttpCode(200)
	@ApiOperation({ summary: "Revoke a refresh token", description: "Idempotent." })
	async logout(@Body() dto: RefreshDto): Promise<MessagedResponse<null>> {
		await this.authService.logout(dto.refreshToken);
		return new MessagedResponse(null, "Signed out");
	}

	@Get("me")
	@ApiBearerAuth()
	@ApiOperation({ summary: "The signed-in account" })
	@ApiOkResponse({ type: AuthUserResponse })
	me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserResponse> {
		return this.authService.me(user.id);
	}
}

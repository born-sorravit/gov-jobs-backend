import { IS_PUBLIC_KEY } from "@/shared/decorators/public.decorator";
import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

/**
 * Registered globally, so every route requires a valid access token unless it carries
 * `@Public()`.
 *
 * The metadata is read with `getAllAndOverride` over handler **and** class: without the
 * class entry, `@Public()` on a controller would be silently ignored and every one of its
 * routes would 401.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
	constructor(private readonly reflector: Reflector) {
		super();
	}

	canActivate(context: ExecutionContext) {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		return isPublic ? true : super.canActivate(context);
	}
}

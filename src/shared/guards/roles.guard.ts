import { UsersRepository } from "@/models/users/user.repository";
import { ROLES_KEY } from "@/shared/decorators/roles.decorator";
import { UserRole } from "@/shared/enums/user-role.enum";
import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedUser } from "@/shared/decorators/current-user.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly usersRepository: UsersRepository
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!required?.length) return true;

		const { user } = context
			.switchToHttp()
			.getRequest<{ user?: AuthenticatedUser }>();
		if (!user) {
			throw new ForbiddenException("Insufficient permissions");
		}

		/**
		 * The role is re-read from the database rather than trusted from the token.
		 *
		 * An access token lives 15 minutes and carries the role it was minted with, so a
		 * promotion would not take effect — and, more importantly, a *demoted* admin would
		 * keep administrative access until their token expired. One extra query on the handful
		 * of admin routes is worth closing that window.
		 */
		const current = await this.usersRepository.findOne({
			where: { id: user.id },
			select: { id: true, role: true },
		});

		if (!current || !required.includes(current.role)) {
			throw new ForbiddenException("Insufficient permissions");
		}

		// Keep the request's view of the user honest for anything downstream.
		user.role = current.role;
		return true;
	}
}

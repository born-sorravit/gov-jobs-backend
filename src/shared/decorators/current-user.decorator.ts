import { UserRole } from "@/shared/enums/user-role.enum";
import { ExecutionContext, createParamDecorator } from "@nestjs/common";

/** The verified access-token payload attached by `JwtStrategy`. */
export interface AuthenticatedUser {
	id: string;
	email: string;
	role: UserRole;
}

export const CurrentUser = createParamDecorator(
	(data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
		const request = context
			.switchToHttp()
			.getRequest<{ user?: AuthenticatedUser }>();
		const user = request.user;
		return data && user ? user[data] : user;
	}
);

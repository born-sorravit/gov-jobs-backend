import { UserRole } from "@/shared/enums/user-role.enum";
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/** Restricts a route to the listed roles. Requires `JwtAuthGuard` to have run first. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

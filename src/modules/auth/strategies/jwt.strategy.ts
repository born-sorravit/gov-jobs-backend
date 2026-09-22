import { AuthenticatedUser } from "@/shared/decorators/current-user.decorator";
import { UserRole } from "@/shared/enums/user-role.enum";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface AccessTokenPayload {
	sub: string;
	email: string;
	role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
	constructor(configService: ConfigService) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: configService.getOrThrow<string>("security.jwt.secret"),
		});
	}

	/**
	 * Runs only after the signature and expiry check pass. The payload is trusted as an
	 * identity claim but deliberately not re-read from the database on every request — a
	 * 15-minute access token is the window in which a role change lags.
	 */
	validate(payload: AccessTokenPayload): AuthenticatedUser {
		return { id: payload.sub, email: payload.email, role: payload.role };
	}
}

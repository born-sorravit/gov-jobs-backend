import { RefreshToken } from "@/models/auth/entities/refresh-token.entity";
import { RefreshTokenRepository } from "@/models/auth/refresh-token.repository";
import { User } from "@/models/users/entities/user.entity";
import { UsersRepository } from "@/models/users/user.repository";
import { EmailLogRepository } from "@/models/email/email-log.repository";
import {
	AuthSessionResponse,
	AuthUserResponse,
	ChangePasswordDto,
	DeleteAccountDto,
	LoginDto,
	RegisterDto,
	UpdateProfileDto,
} from "@/modules/auth/dto/auth.dto";
import { AccessTokenPayload } from "@/modules/auth/strategies/jwt.strategy";
import { UserRole } from "@/shared/enums/user-role.enum";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { IsNull, LessThan } from "typeorm";

/**
 * A real bcrypt hash of a value nobody knows.
 *
 * Login compares against this when the email is unknown, so an unregistered address costs
 * the same ~100ms as a registered one. Without it, response timing tells an attacker which
 * addresses have accounts.
 */
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8e3F6M/lJ2ZPnO4QxQZ7QK9RJZ0vJe";

const INVALID_CREDENTIALS = "Incorrect email or password";

/**
 * How long a just-rotated refresh token keeps working, to absorb concurrent requests.
 *
 * Configurable because it is a security/usability trade-off, not a constant: longer absorbs
 * slower clients, shorter narrows the window in which a stolen token is still usable. Set it
 * to 0 to make rotation strictly single-use.
 */
const ROTATION_GRACE_MS = Number.parseInt(
	process.env.REFRESH_ROTATION_GRACE_MS ?? "15000",
	10
);

@Injectable()
export class AuthService {
	constructor(
		private readonly usersRepository: UsersRepository,
		private readonly refreshTokenRepository: RefreshTokenRepository,
		private readonly emailLogRepository: EmailLogRepository,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService
	) {}

	async register(
		dto: RegisterDto,
		userAgent?: string
	): Promise<AuthSessionResponse> {
		const rounds = this.configService.get<number>("security.bcryptRounds", 10);
		const user = this.usersRepository.create({
			email: dto.email,
			passwordHash: await hash(dto.password, rounds),
			name: dto.name,
			locale: dto.locale ?? "th",
			role: UserRole.USER,
			// No verification flow yet — that arrives with the email module in step 11.
			isVerified: false,
		});

		try {
			await this.usersRepository.save(user);
		} catch (error) {
			// Let the unique index decide, not a prior SELECT: check-then-insert races, and
			// two simultaneous sign-ups for one address would otherwise surface as a 500.
			if (this.isUniqueViolation(error)) {
				throw new ConflictException("An account with this email already exists");
			}
			throw error;
		}

		return this.issueSession(user, userAgent);
	}

	async login(dto: LoginDto, userAgent?: string): Promise<AuthSessionResponse> {
		// `passwordHash` is `select: false` on the entity, so it has to be asked for.
		const user = await this.usersRepository.findOne({
			where: { email: dto.email },
			select: {
				id: true,
				email: true,
				name: true,
				role: true,
				isVerified: true,
				locale: true,
				passwordHash: true,
			},
		});

		const matches = await compare(dto.password, user?.passwordHash ?? DUMMY_HASH);

		// One message for both "no such account" and "wrong password": distinguishing them
		// turns the login form into an account-enumeration oracle.
		if (!user || !matches) {
			throw new UnauthorizedException(INVALID_CREDENTIALS);
		}

		return this.issueSession(user, userAgent);
	}

	/**
	 * Exchanges a refresh token for a new session, rotating the token.
	 *
	 * The presented token is revoked whether or not it was still valid, so a replayed token
	 * is useless and a stolen one dies as soon as the real client refreshes.
	 */
	async refresh(token: string, userAgent?: string): Promise<AuthSessionResponse> {
		const stored = await this.refreshTokenRepository.findOne({
			where: { tokenHash: this.hashToken(token) },
			relations: { user: true },
		});

		if (!stored || stored.expiresAt.getTime() <= Date.now()) {
			throw new UnauthorizedException("Invalid or expired refresh token");
		}

		if (stored.revokedAt && !this.isWithinRotationGrace(stored)) {
			throw new UnauthorizedException("Invalid or expired refresh token");
		}

		// Already revoked by a rotation moments ago: the caller is one of several requests a
		// browser fired at once, not an attacker replaying a stolen token. The existing
		// revocation stands and a session is still issued, so every one of them succeeds.
		if (!stored.revokedAt) {
			await this.refreshTokenRepository.update(stored.id, {
				revokedAt: new Date(),
				revokedReason: "rotated",
			});
		}

		return this.issueSession(stored.user, userAgent);
	}

	/**
	 * A refresh token is single-use, but "use" is not instantaneous across a page load.
	 *
	 * A browser that fires several authenticated requests at a just-expired access token
	 * sends the same refresh token several times. Serialising that on the client is not
	 * possible in general — the frontend runs on serverless instances that share no memory —
	 * so a rotation is forgiven for a few seconds. A logout never is, and a replay outside
	 * the window is still rejected.
	 */
	private isWithinRotationGrace(stored: RefreshToken): boolean {
		if (stored.revokedReason !== "rotated" || !stored.revokedAt) return false;
		return Date.now() - stored.revokedAt.getTime() <= ROTATION_GRACE_MS;
	}

	/** Idempotent: signing out with an already-dead token is still a successful sign-out. */
	async logout(token: string): Promise<void> {
		// `IsNull()`, not `undefined`: TypeORM drops undefined keys from a where clause, which
		// here would have revoked *every* row matching nothing — and throws instead.
		await this.refreshTokenRepository.update(
			{ tokenHash: this.hashToken(token), revokedAt: IsNull() },
			{ revokedAt: new Date(), revokedReason: "logout" }
		);
	}

	async me(userId: string): Promise<AuthUserResponse> {
		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new UnauthorizedException("Account no longer exists");
		}
		return this.toUserResponse(user);
	}

	/**
	 * Name and email language.
	 *
	 * Email is deliberately not editable: it is the identity the account is keyed on, every
	 * alert is addressed to it, and changing it safely needs a verification round-trip that
	 * does not exist yet.
	 */
	async updateProfile(
		userId: string,
		dto: UpdateProfileDto
	): Promise<AuthUserResponse> {
		const user = await this.usersRepository.findOne({ where: { id: userId } });
		if (!user) {
			throw new UnauthorizedException("Account no longer exists");
		}

		// Only the keys actually sent: a PATCH that omits `locale` must not blank it.
		const changes: Partial<User> = {};
		if (dto.name !== undefined) changes.name = dto.name;
		if (dto.locale !== undefined) changes.locale = dto.locale;

		if (Object.keys(changes).length > 0) {
			await this.usersRepository.update(user.id, changes);
			Object.assign(user, changes);
		}

		return this.toUserResponse(user);
	}

	/**
	 * Changes the password and ends every other session.
	 *
	 * Revoking the lot is the point: someone changing their password may be doing it because a
	 * device was lost. A fresh session comes back so the device that made the change stays
	 * signed in — the revoke happens first, so the new token is not caught by it.
	 */
	async changePassword(
		userId: string,
		dto: ChangePasswordDto,
		userAgent?: string
	): Promise<AuthSessionResponse> {
		const user = await this.usersRepository.findOne({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				name: true,
				role: true,
				isVerified: true,
				locale: true,
				passwordHash: true,
			},
		});
		if (!user) {
			throw new UnauthorizedException("Account no longer exists");
		}

		// No dummy-hash dance here: the caller already proved they hold a session, so there is
		// no account to enumerate and the specific message is the more useful one.
		if (!(await compare(dto.currentPassword, user.passwordHash))) {
			throw new UnauthorizedException("Current password is incorrect");
		}

		if (await compare(dto.newPassword, user.passwordHash)) {
			throw new BadRequestException(
				"The new password must be different from the current one"
			);
		}

		const rounds = this.configService.get<number>("security.bcryptRounds", 10);
		await this.usersRepository.update(user.id, {
			passwordHash: await hash(dto.newPassword, rounds),
		});

		await this.refreshTokenRepository.update(
			{ userId: user.id, revokedAt: IsNull() },
			{ revokedAt: new Date(), revokedReason: "password" }
		);

		return this.issueSession(user, userAgent);
	}

	/**
	 * Deletes the account for good.
	 *
	 * Alerts, matches, saved jobs and sessions go with it through `ON DELETE CASCADE`. The
	 * email log does not — it has no foreign key — so it is cleared explicitly rather than
	 * left holding the address of someone who asked to be forgotten.
	 */
	async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
		const user = await this.usersRepository.findOne({
			where: { id: userId },
			select: { id: true, role: true, passwordHash: true },
		});
		if (!user) {
			throw new UnauthorizedException("Account no longer exists");
		}

		if (!(await compare(dto.password, user.passwordHash))) {
			throw new UnauthorizedException("Password is incorrect");
		}

		// Roles are granted by a command with database access, never through the API, so an
		// admin who deletes themselves could lock everyone out of the deployment.
		if (user.role === UserRole.ADMIN) {
			const admins = await this.usersRepository.count({
				where: { role: UserRole.ADMIN },
			});
			if (admins <= 1) {
				throw new ConflictException(
					"The last administrator account cannot be deleted"
				);
			}
		}

		await this.emailLogRepository.delete({ userId: user.id });
		await this.usersRepository.delete(user.id);
	}

	/** Housekeeping for expired and revoked rows; safe to call from a scheduled job. */
	async pruneExpiredTokens(): Promise<number> {
		const result = await this.refreshTokenRepository.delete({
			expiresAt: LessThan(new Date()),
		});
		return result.affected ?? 0;
	}

	private async issueSession(
		user: User,
		userAgent?: string
	): Promise<AuthSessionResponse> {
		const payload: AccessTokenPayload = {
			sub: user.id,
			email: user.email,
			role: user.role,
		};
		const accessToken = await this.jwtService.signAsync(payload);

		// Opaque and high-entropy: there is nothing to verify and nothing to forge, and only
		// its hash is ever written down.
		const refreshToken = randomBytes(48).toString("base64url");
		const ttlDays = this.configService.get<number>("security.refreshTtlDays", 30);

		await this.refreshTokenRepository.insert({
			tokenHash: this.hashToken(refreshToken),
			userId: user.id,
			expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
			userAgent: userAgent?.slice(0, 255) ?? null,
		});

		return {
			accessToken,
			refreshToken,
			expiresIn: this.accessTokenSeconds(),
			user: this.toUserResponse(user),
		};
	}

	private toUserResponse(user: User): AuthUserResponse {
		return {
			id: user.id,
			email: user.email,
			name: user.name,
			role: user.role,
			isVerified: user.isVerified,
			locale: user.locale,
		};
	}

	/** SHA-256 is right here, not bcrypt: the input is already 48 random bytes. */
	private hashToken(token: string): string {
		return createHash("sha256").update(token).digest("hex");
	}

	private accessTokenSeconds(): number {
		const raw = this.configService.get<string>("security.jwt.expiresIn", "15m");
		const match = /^(\d+)([smhd])$/.exec(raw.trim());
		if (!match) return 900;

		const value = Number.parseInt(match[1], 10);
		const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2]] ?? 60;
		return value * unit;
	}

	private isUniqueViolation(error: unknown): boolean {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "23505"
		);
	}
}

import type { EmailLogRepository } from "@/models/email/email-log.repository";
import type { RefreshTokenRepository } from "@/models/auth/refresh-token.repository";
import type { User } from "@/models/users/entities/user.entity";
import type { UsersRepository } from "@/models/users/user.repository";
import { AuthService } from "@/modules/auth/auth.service";
import { UserRole } from "@/shared/enums/user-role.enum";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { hash } from "bcryptjs";

const PASSWORD = "Passw0rd!23";
/** Cost 4, not the configured 10: this suite hashes on every case and asserts nothing about cost. */
const ROUNDS = 4;

const build = () => {
	const usersRepository = {
		findOne: jest.fn(),
		count: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	};
	const refreshTokenRepository = { update: jest.fn(), insert: jest.fn() };
	const emailLogRepository = { delete: jest.fn() };
	const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
	const configService = {
		get: (key: string, fallback?: unknown) =>
			key === "security.bcryptRounds" ? ROUNDS : fallback,
	};

	const service = new AuthService(
		usersRepository as unknown as UsersRepository,
		refreshTokenRepository as unknown as RefreshTokenRepository,
		emailLogRepository as unknown as EmailLogRepository,
		jwtService as unknown as JwtService,
		configService as unknown as ConfigService
	);

	return { service, usersRepository, refreshTokenRepository, emailLogRepository };
};

const account = async (over: Partial<User> = {}): Promise<User> =>
	({
		id: "user-1",
		email: "someone@example.test",
		name: "Someone",
		role: UserRole.USER,
		isVerified: false,
		locale: "th",
		passwordHash: await hash(PASSWORD, ROUNDS),
		...over,
	}) as User;

describe("deleting an account", () => {
	it("refuses to remove the only administrator", async () => {
		const { service, usersRepository, emailLogRepository } = build();
		usersRepository.findOne.mockResolvedValue(
			await account({ role: UserRole.ADMIN })
		);
		usersRepository.count.mockResolvedValue(1);

		await expect(
			service.deleteAccount("user-1", { password: PASSWORD })
		).rejects.toBeInstanceOf(ConflictException);

		// Roles are granted by a command with database access, so losing the last admin would
		// lock everyone out of the deployment for good.
		expect(usersRepository.delete).not.toHaveBeenCalled();
		expect(emailLogRepository.delete).not.toHaveBeenCalled();
	});

	it("removes an administrator while another one remains", async () => {
		const { service, usersRepository, emailLogRepository } = build();
		usersRepository.findOne.mockResolvedValue(
			await account({ role: UserRole.ADMIN })
		);
		usersRepository.count.mockResolvedValue(2);

		await service.deleteAccount("user-1", { password: PASSWORD });

		expect(usersRepository.delete).toHaveBeenCalledWith("user-1");
		expect(emailLogRepository.delete).toHaveBeenCalledWith({ userId: "user-1" });
	});

	it("never counts administrators for an ordinary account", async () => {
		const { service, usersRepository } = build();
		usersRepository.findOne.mockResolvedValue(await account());

		await service.deleteAccount("user-1", { password: PASSWORD });

		expect(usersRepository.count).not.toHaveBeenCalled();
		expect(usersRepository.delete).toHaveBeenCalledWith("user-1");
	});

	it("rejects a wrong password and deletes nothing", async () => {
		const { service, usersRepository, emailLogRepository } = build();
		usersRepository.findOne.mockResolvedValue(await account());

		await expect(
			service.deleteAccount("user-1", { password: "not-the-password" })
		).rejects.toBeInstanceOf(UnauthorizedException);

		expect(usersRepository.delete).not.toHaveBeenCalled();
		expect(emailLogRepository.delete).not.toHaveBeenCalled();
	});
});

describe("changing a password", () => {
	it("revokes every live session before issuing the replacement", async () => {
		const { service, usersRepository, refreshTokenRepository } = build();
		usersRepository.findOne.mockResolvedValue(await account());

		const order: string[] = [];
		refreshTokenRepository.update.mockImplementation(() => {
			order.push("revoke");
			return Promise.resolve({ affected: 3 });
		});
		refreshTokenRepository.insert.mockImplementation(() => {
			order.push("issue");
			return Promise.resolve({});
		});

		const session = await service.changePassword("user-1", {
			currentPassword: PASSWORD,
			newPassword: "Brand!New123",
		});

		// Order matters: revoking after issuing would kill the token just handed back.
		expect(order).toEqual(["revoke", "issue"]);
		expect(refreshTokenRepository.update).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "user-1" }),
			expect.objectContaining({ revokedReason: "password" })
		);
		expect(session.accessToken).toBe("access-token");
	});

	it("leaves the password alone when the current one is wrong", async () => {
		const { service, usersRepository, refreshTokenRepository } = build();
		usersRepository.findOne.mockResolvedValue(await account());

		await expect(
			service.changePassword("user-1", {
				currentPassword: "wrong",
				newPassword: "Brand!New123",
			})
		).rejects.toBeInstanceOf(UnauthorizedException);

		expect(usersRepository.update).not.toHaveBeenCalled();
		expect(refreshTokenRepository.update).not.toHaveBeenCalled();
	});
});

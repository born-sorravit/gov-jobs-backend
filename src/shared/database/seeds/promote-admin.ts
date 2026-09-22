import { User } from "@/models/users/entities/user.entity";
import { dataSourceOptions } from "@/shared/database/typeorm.config";
import { UserRole } from "@/shared/enums/user-role.enum";
import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

/**
 * Grants or revokes the admin role.
 *
 * There is deliberately no API for this: an endpoint that changes roles is the single most
 * valuable thing to attack on the whole service, and the number of administrators here is
 * small enough that a command is the right shape.
 *
 *   npm run admin:promote --email=someone@example.com
 *   npm run admin:promote --email=someone@example.com --demote
 */
const run = async (): Promise<void> => {
	const logger = new Logger("PromoteAdmin");
	const email = process.env.npm_config_email?.trim().toLowerCase();
	const demote = process.env.npm_config_demote === "true";

	if (!email) {
		logger.error(
			"Usage: npm run admin:promote --email=someone@example.com [--demote=true]"
		);
		process.exit(1);
	}

	const dataSource = new DataSource(dataSourceOptions);
	await dataSource.initialize();

	try {
		const users = dataSource.getRepository(User);
		const user = await users.findOne({ where: { email } });

		// Loudly, rather than reporting success for a typo.
		if (!user) {
			logger.error(`No account found for ${email}`);
			process.exit(1);
		}

		const role = demote ? UserRole.USER : UserRole.ADMIN;
		if (user.role === role) {
			logger.log(`${email} is already ${role}; nothing to do`);
			return;
		}

		await users.update(user.id, { role });
		logger.log(`${email}: ${user.role} -> ${role}`);
		// `RolesGuard` re-reads the role from the database on every admin request, so this
		// takes effect immediately rather than when their access token next rotates.
		logger.log("Effective immediately; reload the page to see the nav item appear.");
	} finally {
		await dataSource.destroy();
	}
};

run().catch((error) => {
	new Logger("PromoteAdmin").error(
		error instanceof Error ? error.message : String(error)
	);
	process.exit(1);
});

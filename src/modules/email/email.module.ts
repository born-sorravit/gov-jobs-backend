import { MailConfig } from "@/config/configuration";
import { EmailService } from "@/modules/email/email.service";
import { EMAIL_PROVIDER } from "@/modules/email/interfaces/email-provider.interface";
import { ConsoleEmailProvider } from "@/modules/email/providers/console.provider";
import { ResendEmailProvider } from "@/modules/email/providers/resend.provider";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * The provider is chosen once, here, from configuration.
 *
 * Nothing downstream knows which one it got — that is the whole point of requirement 9's
 * "do not couple business logic directly to one email provider".
 */
@Module({
	providers: [
		ConsoleEmailProvider,
		{
			provide: EMAIL_PROVIDER,
			inject: [ConfigService, ConsoleEmailProvider],
			useFactory: (config: ConfigService, fallback: ConsoleEmailProvider) => {
				const mail = config.getOrThrow<MailConfig>("mail");
				return mail.provider === "resend"
					? new ResendEmailProvider(config)
					: fallback;
			},
		},
		EmailService,
	],
	exports: [EmailService],
})
export class EmailModule {}

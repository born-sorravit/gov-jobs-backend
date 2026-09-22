import { MailConfig } from "@/config/configuration";
import {
	EmailMessage,
	EmailProvider,
	EmailSendResult,
} from "@/modules/email/interfaces/email-provider.interface";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

@Injectable()
export class ResendEmailProvider implements EmailProvider {
	readonly name = "resend";
	private readonly client: Resend;
	private readonly config: MailConfig;

	constructor(configService: ConfigService) {
		this.config = configService.getOrThrow<MailConfig>("mail");
		if (!this.config.apiKey) {
			throw new Error("MAIL_PROVIDER=resend requires RESEND_API_KEY");
		}
		this.client = new Resend(this.config.apiKey);
	}

	async send(message: EmailMessage): Promise<EmailSendResult> {
		const { data, error } = await this.client.emails.send({
			from: this.config.from,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
			replyTo: this.config.replyTo,
		});

		// Resend reports failures in the body rather than by throwing, so this has to be
		// turned into one — otherwise a rejected send would be logged as delivered.
		if (error) {
			throw new Error(`Resend rejected the message: ${error.message}`);
		}

		return { providerMessageId: data?.id ?? null };
	}
}

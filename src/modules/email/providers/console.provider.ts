import {
	EmailMessage,
	EmailProvider,
	EmailSendResult,
} from "@/modules/email/interfaces/email-provider.interface";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/**
 * Writes the email to the log instead of sending it.
 *
 * The default, so a fresh checkout runs the whole alert pipeline end to end without an API
 * key and without mailing anyone by accident.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
	readonly name = "console";
	private readonly logger = new Logger(ConsoleEmailProvider.name);

	async send(message: EmailMessage): Promise<EmailSendResult> {
		// Headers are logged too: without them there is no way to tell locally whether
		// `List-Unsubscribe` was actually set, and "it looked fine in dev" is how that header
		// goes missing in production.
		const headers = Object.entries(message.headers ?? {})
			.map(([name, value]) => `\n  ${name}: ${value}`)
			.join("");

		this.logger.log(
			`[email] to=${message.to} subject=${message.subject}${headers}\n${message.text.slice(0, 800)}`
		);
		return { providerMessageId: `console-${randomUUID()}` };
	}
}

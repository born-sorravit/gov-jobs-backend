export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
	/**
	 * Raw SMTP headers, for the ones that have to be headers rather than body content —
	 * `List-Unsubscribe` and `List-Unsubscribe-Post`, which is what makes a mail client show
	 * its own unsubscribe button. A link in the footer alone does not.
	 */
	headers?: Record<string, string>;
}

export interface EmailSendResult {
	/** The provider's own id, kept on the log so a delivery can be traced back to them. */
	providerMessageId: string | null;
}

/**
 * The seam between "we decided to send something" and "a vendor sent it".
 *
 * Business logic depends on this and never on Resend: swapping provider is a new class and a
 * config value, and `console` keeps local development and CI free of network calls entirely.
 */
export interface EmailProvider {
	readonly name: string;
	send(message: EmailMessage): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

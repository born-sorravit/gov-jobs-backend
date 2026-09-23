import { UnsubscribeService } from "@/modules/job-alerts/unsubscribe.service";
import { Public } from "@/shared/decorators/public.decorator";
import { Body, Controller, Get, HttpCode, Post, Query, Res } from "@nestjs/common";
import {
	ApiExcludeEndpoint,
	ApiOperation,
	ApiQuery,
	ApiTags,
} from "@nestjs/swagger";
// Type-only: a type in a decorated signature cannot be a value import under
// isolatedModules + emitDecoratorMetadata.
import type { Response } from "express";

/** Minimal, self-contained, and inlined: an unsubscribe page must not depend on anything. */
const page = (title: string, body: string): string => `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f9fafb;font-family:'Noto Sans Thai','Sarabun','Leelawadee UI',Tahoma,-apple-system,sans-serif;color:#111827">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
${body}
</div>
</body>
</html>`;

const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[char] ?? char
	);

/**
 * Turning an alert off from the link in its own email.
 *
 * Public by design — the point is that someone with no account can stop the mail. The token
 * is the whole authorisation, which is why it is 32 random bytes and why an unknown one is a
 * flat 404 rather than anything that distinguishes "wrong" from "malformed".
 *
 * The default throttle is deliberately left on: this is a public endpoint that mutates state
 * from a bearer string, and rate limiting is what keeps it from being swept.
 */
@Public()
@ApiTags("job-alerts")
@Controller("alerts/unsubscribe")
export class UnsubscribeController {
	constructor(private readonly unsubscribeService: UnsubscribeService) {}

	/**
	 * The confirmation page. **Reads only.**
	 *
	 * Mail clients, link scanners and corporate security gateways follow links in email with
	 * GET, unprompted. If GET switched the alert off, a scanner opening the message would
	 * silently unsubscribe the user — so the change is behind the POST below, and this only
	 * renders a button.
	 */
	@Get()
	@ApiExcludeEndpoint()
	async confirm(@Query("token") token = "", @Res() res: Response): Promise<void> {
		const { alertName, isActive } = await this.unsubscribeService.peek(token);

		res.type("html").send(
			page(
				"ยกเลิกการแจ้งเตือน",
				isActive
					? `<h1 style="margin:0 0 12px;font-size:20px">ยกเลิกการแจ้งเตือน</h1>
			<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151">
				ต้องการหยุดรับอีเมลแจ้งเตือนจาก “${escapeHtml(alertName)}” ใช่หรือไม่
			</p>
			<form method="post">
				<input type="hidden" name="token" value="${escapeHtml(token)}">
				<button type="submit" style="background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:11px 18px;font-size:15px;cursor:pointer">
					ยืนยันการยกเลิก
				</button>
			</form>`
					: `<h1 style="margin:0 0 12px;font-size:20px">ยกเลิกแล้ว</h1>
			<p style="margin:0;font-size:15px;line-height:1.7;color:#374151">
				การแจ้งเตือน “${escapeHtml(alertName)}” ถูกปิดอยู่แล้ว คุณจะไม่ได้รับอีเมลจากรายการนี้อีก
			</p>`
			)
		);
	}

	/**
	 * The one that actually unsubscribes, and the RFC 8058 one-click target.
	 *
	 * A mail client that honours `List-Unsubscribe-Post` sends `List-Unsubscribe=One-Click`
	 * as a form body to this URL with no user interaction beyond pressing its own button, so
	 * the response is for a machine as much as a person. 200 either way; a token that has
	 * already been used is a success, not an error.
	 */
	@Post()
	@HttpCode(200)
	@ApiOperation({ summary: "Switch an alert off from its email link" })
	@ApiQuery({ name: "token", required: true })
	async unsubscribe(
		@Query("token") queryToken = "",
		// The confirmation page's own form posts the token in the body as well. A one-click
		// client posts only to the URL, so the query is the primary source and this is the
		// fallback — accepting both means the page and this handler cannot drift apart.
		@Body("token") bodyToken = "",
		@Res() res: Response
	): Promise<void> {
		const { alertName } = await this.unsubscribeService.unsubscribe(
			queryToken || bodyToken
		);

		res.type("html").send(
			page(
				"ยกเลิกการแจ้งเตือนแล้ว",
				`<h1 style="margin:0 0 12px;font-size:20px">ยกเลิกเรียบร้อย</h1>
			<p style="margin:0;font-size:15px;line-height:1.7;color:#374151">
				คุณจะไม่ได้รับอีเมลแจ้งเตือนจาก “${escapeHtml(alertName)}” อีก
			</p>`
			)
		);
	}
}

import { NotificationDispatchService } from "@/modules/notifications/notification-dispatch.service";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { Public } from "@/shared/decorators/public.decorator";
import {
	INTERNAL_API_KEY_HEADER,
	InternalApiKeyGuard,
} from "@/shared/guards/internal-api-key.guard";
import { Controller, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";

@ApiTags("internal")
@Public()
@Controller("internal/digests")
@UseGuards(InternalApiKeyGuard)
@ApiHeader({ name: INTERNAL_API_KEY_HEADER, required: true })
export class NotificationsController {
	constructor(private readonly dispatchService: NotificationDispatchService) {}

	/**
	 * Queues the digests that are due.
	 *
	 * Driven by the same external scheduler as the crawl, for the same reason: the free-tier
	 * instance sleeps, so an in-process timer would fire only when someone happened to be
	 * browsing — which is not a daily digest.
	 */
	@SkipThrottle()
	@Post("run")
	@HttpCode(200)
	@ApiOperation({ summary: "Queue daily or weekly digests" })
	@ApiQuery({
		name: "frequency",
		enum: [AlertFrequency.DAILY, AlertFrequency.WEEKLY],
	})
	async run(
		@Query("frequency") frequency?: string
	): Promise<{ frequency: AlertFrequency; queued: number }> {
		const resolved =
			frequency?.toUpperCase() === AlertFrequency.WEEKLY
				? AlertFrequency.WEEKLY
				: AlertFrequency.DAILY;

		return {
			frequency: resolved,
			queued: await this.dispatchService.dispatchDigests(resolved),
		};
	}
}

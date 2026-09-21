import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

@ApiTags("health")
// Version-neutral and outside the global prefix, so the URL stays a plain /healthcheck.
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	/**
	 * Excluded from the global prefix and from throttling: the external scheduler pings
	 * this to wake the free-tier instance before triggering a crawl.
	 */
	@SkipThrottle()
	@Get("healthcheck")
	@ApiOperation({ summary: "Liveness and database connectivity" })
	async healthcheck() {
		let database = "down";
		try {
			await this.dataSource.query("SELECT 1");
			database = "up";
		} catch {
			database = "down";
		}

		return { status: "ok", database, timestamp: new Date().toISOString() };
	}
}

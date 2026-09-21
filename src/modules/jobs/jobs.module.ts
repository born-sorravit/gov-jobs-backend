import { JobsController } from "@/modules/jobs/jobs.controller";
import { JobsService } from "@/modules/jobs/jobs.service";
import { Module } from "@nestjs/common";

@Module({
	// Repositories come from the global ModelModule; nothing to import here.
	controllers: [JobsController],
	providers: [JobsService],
	exports: [JobsService],
})
export class JobsModule {}

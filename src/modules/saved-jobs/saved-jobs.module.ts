import { SavedJobsController } from "@/modules/saved-jobs/saved-jobs.controller";
import { SavedJobsService } from "@/modules/saved-jobs/saved-jobs.service";
import { Module } from "@nestjs/common";

@Module({
	controllers: [SavedJobsController],
	providers: [SavedJobsService],
	exports: [SavedJobsService],
})
export class SavedJobsModule {}

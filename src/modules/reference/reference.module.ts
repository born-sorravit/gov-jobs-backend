import { ReferenceController } from "@/modules/reference/reference.controller";
import { ReferenceService } from "@/modules/reference/reference.service";
import { Module } from "@nestjs/common";

@Module({
	controllers: [ReferenceController],
	providers: [ReferenceService],
	exports: [ReferenceService],
})
export class ReferenceModule {}

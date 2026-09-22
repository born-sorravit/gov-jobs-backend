import { AdminController } from "@/modules/admin/admin.controller";
import { AdminService } from "@/modules/admin/admin.service";
import { Module } from "@nestjs/common";

@Module({
	controllers: [AdminController],
	providers: [AdminService],
})
export class AdminModule {}

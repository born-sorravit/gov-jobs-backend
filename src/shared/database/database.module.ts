import { dataSourceOptions } from "@/shared/database/typeorm.config";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
	imports: [
		TypeOrmModule.forRoot({
			...dataSourceOptions,
			// Runtime resolves entities from the compiled output Nest is already serving.
			autoLoadEntities: false,
			migrationsRun: false,
		}),
	],
})
export class DatabaseModule {}

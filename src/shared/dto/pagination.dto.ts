import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export enum OrderDirection {
	ASC = "ASC",
	DESC = "DESC",
}

export class PaginationDto {
	@ApiPropertyOptional({ default: 1, minimum: 1, description: "Page number" })
	@IsOptional()
	@IsInt()
	@Min(1)
	@Type(() => Number)
	page: number = 1;

	@ApiPropertyOptional({
		default: 20,
		minimum: 1,
		maximum: 100,
		description: "Items per page",
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(100)
	@Type(() => Number)
	limit: number = 20;

	@ApiPropertyOptional({ example: "createdAt", description: "Field to sort by" })
	@IsOptional()
	sortBy?: string;

	@ApiPropertyOptional({ enum: OrderDirection, default: OrderDirection.DESC })
	@IsOptional()
	@IsIn(Object.values(OrderDirection))
	order: OrderDirection = OrderDirection.DESC;
}

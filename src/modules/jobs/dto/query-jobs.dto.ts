import { PaginationDto } from "@/shared/dto/pagination.dto";
import {
	toBoolean,
	toNumberArray,
	toTrimmedString,
} from "@/shared/dto/transform.util";
import { JobStatus } from "@/shared/enums/job-status.enum";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Min,
} from "class-validator";

/** API sort keys -> SQL expressions. Anything not listed here is rejected, not interpolated. */
export const JOB_SORTABLE_COLUMNS: Record<string, string> = {
	publishedAt: "job.published_at",
	applicationEnd: "job.application_end",
	applicationStart: "job.application_start",
	salaryMax: "job.salary_max",
	salaryMin: "job.salary_min",
	title: "job.title",
	firstSeenAt: "job.first_seen_at",
};

export class QueryJobsDto extends PaginationDto {
	@ApiPropertyOptional({
		description: "Free-text search over position title, agency and ministry",
		example: "นักวิชาการคอมพิวเตอร์",
	})
	@IsOptional()
	@IsString()
	@Transform(toTrimmedString)
	q?: string;

	@ApiPropertyOptional({
		description:
			"Position type ids (reference kind JOB_TYPE). Repeat or comma-separate.",
		type: [Number],
	})
	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	@Transform(toNumberArray)
	jobType?: number[];

	@ApiPropertyOptional({
		description: "Job category ids (ข้าราชการพลเรือน / พนักงานราชการ / อื่น ๆ)",
		type: [Number],
	})
	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	@Transform(toNumberArray)
	jobCategory?: number[];

	@ApiPropertyOptional({ description: "Education level ids", type: [Number] })
	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	@Transform(toNumberArray)
	education?: number[];

	@ApiPropertyOptional({ description: "Province ids", type: [Number] })
	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	@Transform(toNumberArray)
	province?: number[];

	@ApiPropertyOptional({
		description:
			"By default a province filter also returns announcements with no province listed, " +
			"because those are nationwide postings and matter to every applicant. Set true to " +
			"return only announcements that name one of the selected provinces.",
		default: false,
	})
	@IsOptional()
	@IsBoolean()
	@Transform(toBoolean)
	provinceStrict?: boolean;

	@ApiPropertyOptional({ enum: JobStatus, description: "Application period status" })
	@IsOptional()
	@IsEnum(JobStatus)
	status?: JobStatus;

	@ApiPropertyOptional({ description: "Lowest acceptable salary (THB/month)" })
	@IsOptional()
	@IsInt()
	@Min(0)
	@Type(() => Number)
	salaryMin?: number;

	@ApiPropertyOptional({ description: "Highest acceptable salary (THB/month)" })
	@IsOptional()
	@IsInt()
	@Min(0)
	@Type(() => Number)
	salaryMax?: number;
}

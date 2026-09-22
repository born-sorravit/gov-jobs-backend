import { PaginationDto } from "@/shared/dto/pagination.dto";
import { toNumberArray } from "@/shared/dto/transform.util";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEmail,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";

/** Keeps one alert from becoming a denial-of-service against the matcher. */
const MAX_KEYWORDS = 20;
const MAX_FILTER_IDS = 50;

export class CreateJobAlertDto {
	@ApiProperty({ example: "งานไอทีในกรุงเทพ" })
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	@Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
	name: string;

	@ApiPropertyOptional({
		type: [String],
		description:
			"Matched as substrings against the position title and the agency name. Thai has no " +
			"word boundaries, so 'นักวิชาการคอมพิวเตอร์' matches 'นักวิชาการคอมพิวเตอร์ปฏิบัติการ'.",
		example: ["นักวิชาการคอมพิวเตอร์", "นักพัฒนาระบบ"],
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_KEYWORDS)
	@IsString({ each: true })
	@MaxLength(120, { each: true })
	@Transform(({ value }) =>
		Array.isArray(value)
			? [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))]
			: value
	)
	keywords?: string[];

	@ApiPropertyOptional({
		type: [Number],
		description: "Position type ids; empty means any",
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_FILTER_IDS)
	@IsInt({ each: true })
	@Transform(toNumberArray)
	jobTypes?: number[];

	@ApiPropertyOptional({
		type: [Number],
		description: "Education level ids; empty means any",
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_FILTER_IDS)
	@IsInt({ each: true })
	@Transform(toNumberArray)
	educations?: number[];

	@ApiPropertyOptional({
		type: [Number],
		description: "Province ids; empty means anywhere",
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(MAX_FILTER_IDS)
	@IsInt({ each: true })
	@Transform(toNumberArray)
	provinces?: number[];

	@ApiPropertyOptional({ description: "Defaults to the account's email" })
	@IsOptional()
	@IsEmail()
	@MaxLength(255)
	@Transform(({ value }) =>
		typeof value === "string" ? value.trim().toLowerCase() : value
	)
	notificationEmail?: string;

	@ApiPropertyOptional({ enum: AlertFrequency, default: AlertFrequency.IMMEDIATE })
	@IsOptional()
	@IsEnum(AlertFrequency)
	frequency?: AlertFrequency;
}

/**
 * Every field optional. `matchFrom` is deliberately **not** editable: an alert's floor moves
 * only when it is created or resumed, so editing cannot be used to replay the archive.
 */
export class UpdateJobAlertDto extends PartialType(CreateJobAlertDto) {
	@ApiPropertyOptional()
	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}

export class QueryJobAlertsDto extends PaginationDto {}

export class JobAlertResponse {
	@ApiProperty() id: string;
	@ApiProperty() name: string;
	@ApiProperty({ type: [String] }) keywords: string[];
	@ApiProperty({ type: [Number] }) jobTypes: number[];
	@ApiProperty({ type: [Number] }) educations: number[];
	@ApiProperty({ type: [Number] }) provinces: number[];
	@ApiProperty() notificationEmail: string;
	@ApiProperty({ enum: AlertFrequency }) frequency: AlertFrequency;
	@ApiProperty() isActive: boolean;
	@ApiProperty({
		description: "Announcements discovered before this are never matched.",
	})
	matchFrom: string;
	@ApiPropertyOptional() lastSentAt: string | null;
	@ApiProperty() createdAt: string;
	@ApiProperty({ description: "How many announcements have matched so far." })
	matchCount: number;
}

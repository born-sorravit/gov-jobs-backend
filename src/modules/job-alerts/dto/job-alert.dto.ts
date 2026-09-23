import { PaginationDto } from "@/shared/dto/pagination.dto";
import { toNumberArray } from "@/shared/dto/transform.util";
import { AlertFrequency } from "@/shared/enums/alert-frequency.enum";
import { normalizeThaiText } from "@/shared/utils/thai-text.util";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
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
	// Normalised here, not only at match time: Thai spells `ำ` two ways that look identical
	// and compare unequal, and a keyword saved in one spelling would silently never match
	// announcements published in the other. Announcement text is normalised the same way, so
	// both sides of the comparison agree. De-duplication runs *after*, or the two spellings
	// of one word would survive as two keywords.
	@Transform(({ value }) =>
		Array.isArray(value)
			? [
					...new Set(
						value
							.map((entry) => normalizeThaiText(String(entry)).trim())
							.filter(Boolean)
					),
				]
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

	/**
	 * Deliberately **not** settable.
	 *
	 * An alert is always delivered to the address of the account that owns it. When the client
	 * could choose, anyone could enter a stranger's address and mail them announcements they
	 * never asked for and — having no account — could not stop. That is someone else's
	 * personal data being processed without a basis for it, and it is the reason the field is
	 * gone rather than merely validated: a field that does not exist cannot be abused.
	 *
	 * The account's own email is not editable either (`AuthService.updateProfile`), so the
	 * stored address cannot drift away from the owner afterwards.
	 */

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
	@ApiProperty({ description: "Always the owner account's email; not settable." })
	notificationEmail: string;
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

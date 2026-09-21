import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ReferenceOption {
	/** The source portal's own integer id — what `job.province_ids` and friends store. */
	@ApiProperty() id: number;
	@ApiProperty() nameTh: string;
	/** Our translation. Null where none exists yet; clients fall back to `nameTh`. */
	@ApiPropertyOptional() nameEn: string | null;
}

export class ReferenceResponse {
	@ApiProperty({ type: [ReferenceOption] }) provinces: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) educationLevels: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) jobTypes: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) jobCategories: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) jobLevels: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) jobSelections: ReferenceOption[];
	@ApiProperty({ type: [ReferenceOption] }) jobConditions: ReferenceOption[];
}

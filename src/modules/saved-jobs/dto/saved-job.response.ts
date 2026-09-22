import { JobSummaryResponse } from "@/modules/jobs/dto/job.response";
import { ApiProperty } from "@nestjs/swagger";

export class SavedJobResponse extends JobSummaryResponse {
	@ApiProperty({ description: "When the user saved it, not when it was published." })
	savedAt: string;
}

export class SaveJobResultResponse {
	@ApiProperty({
		description: "Always true after a successful save — the call is idempotent.",
	})
	saved: boolean;

	@ApiProperty() jobId: string;
}

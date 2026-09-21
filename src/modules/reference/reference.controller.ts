import { ReferenceResponse } from "@/modules/reference/reference.response";
import { ReferenceService } from "@/modules/reference/reference.service";
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("reference")
@Controller("reference")
export class ReferenceController {
	constructor(private readonly referenceService: ReferenceService) {}

	@Get()
	@ApiOperation({
		summary:
			"Taxonomies for the filter UI (provinces, education levels, position types …)",
		description:
			"Labels for the integer ids stored on jobs and alerts, in Thai and English. Static " +
			"between crawls, so clients should cache it.",
	})
	@ApiOkResponse({ type: ReferenceResponse })
	findAll(): Promise<ReferenceResponse> {
		return this.referenceService.findAll();
	}
}

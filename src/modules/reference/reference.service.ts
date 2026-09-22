import { ReferenceKind } from "@/models/reference/entities/reference-item.entity";
import { ReferenceItemRepository } from "@/models/reference/reference-item.repository";
import {
	ReferenceOption,
	ReferenceResponse,
} from "@/modules/reference/reference.response";
import { JobSource } from "@/shared/enums/job-source.enum";
import { CacheService } from "@/shared/cache/cache.service";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ReferenceService {
	constructor(
		private readonly referenceRepository: ReferenceItemRepository,
		private readonly cacheService: CacheService
	) {}

	/**
	 * Every taxonomy the filter UI needs, in one request.
	 *
	 * The frontend cannot render a single dropdown without these: `job.province_ids` and
	 * friends store the source's integer ids, and the labels live only here. Returning both
	 * languages lets the client switch locale without a refetch.
	 */
	async findAll(source: JobSource = JobSource.OCSC): Promise<ReferenceResponse> {
		// Static between crawls and requested by every page, so it is the one thing here
		// genuinely worth caching. The crawler drops the entry when it syncs the taxonomies.
		return this.cacheService.remember(
			`reference:${source}`,
			() => this.load(source),
			3600
		);
	}

	/** Frees the cached copy; called after a crawl refreshes the taxonomies. */
	async invalidate(source: JobSource = JobSource.OCSC): Promise<void> {
		await this.cacheService.forget(`reference:${source}`);
	}

	private async load(source: JobSource): Promise<ReferenceResponse> {
		const items = await this.referenceRepository.find({
			where: { source },
			order: { kind: "ASC", sortOrder: "ASC" },
		});

		const byKind = (kind: ReferenceKind): ReferenceOption[] =>
			items
				.filter((item) => item.kind === kind)
				.map((item) => ({
					id: item.externalId,
					nameTh: item.nameTh,
					nameEn: item.nameEn,
				}));

		return {
			provinces: byKind(ReferenceKind.PROVINCE),
			educationLevels: byKind(ReferenceKind.EDUCATION_LEVEL),
			jobTypes: byKind(ReferenceKind.JOB_TYPE),
			jobCategories: byKind(ReferenceKind.JOB_CATEGORY),
			jobLevels: byKind(ReferenceKind.JOB_LEVEL),
			jobSelections: byKind(ReferenceKind.JOB_SELECTION),
			jobConditions: byKind(ReferenceKind.JOB_CONDITION),
		};
	}
}

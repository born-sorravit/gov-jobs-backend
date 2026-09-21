import { OrderDirection, PaginationDto } from "@/shared/dto/pagination.dto";
import { PaginationMeta } from "@/shared/interfaces/response.interface";
import { BadRequestException } from "@nestjs/common";
import { ObjectLiteral, SelectQueryBuilder } from "typeorm";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class PaginatedResponse<T> {
	data: T[];
	meta: PaginationMeta;

	constructor(data: T[], total: number, page: number, limit: number) {
		this.data = data;
		this.meta = {
			total,
			page,
			last_page: total === 0 ? 0 : Math.ceil(total / limit),
			limit,
		};
	}

	/** Re-wrap the page with mapped items while keeping the same meta. */
	map<U>(mapper: (item: T, index: number) => U): PaginatedResponse<U> {
		const mapped = new PaginatedResponse<U>([], 0, this.meta.page, this.meta.limit);
		mapped.data = this.data.map(mapper);
		mapped.meta = this.meta;
		return mapped;
	}
}

export type PaginationQuery = Pick<PaginationDto, "page" | "limit"> &
	Partial<Pick<PaginationDto, "sortBy" | "order">>;

export interface PaginationOptions {
	page: number;
	limit: number;
	skip: number;
	sortBy?: string;
	order: OrderDirection;
}

export const getPaginationOptions = (query: PaginationQuery): PaginationOptions => {
	const page = Math.max(1, query.page || 1);
	const limit = Math.max(
		1,
		Math.min(MAX_PAGE_SIZE, query.limit || DEFAULT_PAGE_SIZE)
	);

	return {
		page,
		limit,
		skip: (page - 1) * limit,
		sortBy: query.sortBy,
		order: query.order ?? OrderDirection.DESC,
	};
};

/**
 * Paginates a query builder.
 *
 * `sortable` is an allow-list mapping an API sort key to a SQL expression. It is required
 * whenever `sortBy` is accepted from a client — interpolating a raw user string into
 * `orderBy` is an injection hole.
 */
export async function paginate<T extends ObjectLiteral>(
	queryBuilder: SelectQueryBuilder<T>,
	query: PaginationQuery,
	sortable?: Record<string, string>,
	defaultSort?: { expression: string; order?: OrderDirection }
): Promise<PaginatedResponse<T>> {
	const { page, limit, skip, sortBy, order } = getPaginationOptions(query);

	if (sortBy) {
		const expression = sortable?.[sortBy];
		if (!expression) {
			throw new BadRequestException(
				`Cannot sort by "${sortBy}". Allowed: ${Object.keys(sortable ?? {}).join(", ") || "none"}`
			);
		}
		// NULLS LAST in both directions: Postgres puts nulls first on DESC, which would lead
		// a salary-sorted list with the announcements that never published one.
		queryBuilder.orderBy(expression, order, "NULLS LAST");
	} else if (defaultSort) {
		queryBuilder.orderBy(
			defaultSort.expression,
			defaultSort.order ?? order,
			"NULLS LAST"
		);
	}

	// A deterministic tiebreaker keeps pages stable when the sort key has duplicates.
	queryBuilder.addOrderBy(`${queryBuilder.alias}.id`, OrderDirection.DESC);

	const [data, total] = await queryBuilder.take(limit).skip(skip).getManyAndCount();

	return new PaginatedResponse(data, total, page, limit);
}

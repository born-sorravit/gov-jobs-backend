import { OrderDirection } from "@/shared/dto/pagination.dto";
import {
	MAX_PAGE_SIZE,
	PaginatedResponse,
	getPaginationOptions,
} from "@/shared/utils/pagination.util";

describe("getPaginationOptions", () => {
	it("applies the defaults when nothing is supplied", () => {
		expect(getPaginationOptions({ page: 0, limit: 0 })).toMatchObject({
			page: 1,
			limit: 20,
			skip: 0,
			order: OrderDirection.DESC,
		});
	});

	it("computes skip from page and limit", () => {
		expect(getPaginationOptions({ page: 3, limit: 25 }).skip).toBe(50);
	});

	it("clamps limit to the maximum page size", () => {
		expect(getPaginationOptions({ page: 1, limit: 5000 }).limit).toBe(MAX_PAGE_SIZE);
	});

	it("clamps a negative page to the first page", () => {
		expect(getPaginationOptions({ page: -4, limit: 10 })).toMatchObject({
			page: 1,
			skip: 0,
		});
	});
});

describe("PaginatedResponse", () => {
	it("reports the last page", () => {
		expect(new PaginatedResponse([1, 2], 21, 1, 10).meta).toEqual({
			total: 21,
			page: 1,
			last_page: 3,
			limit: 10,
		});
	});

	it("reports last_page 0 for an empty result rather than 1", () => {
		expect(new PaginatedResponse([], 0, 1, 10).meta.last_page).toBe(0);
	});

	it("keeps meta intact when mapping items to a DTO", () => {
		const page = new PaginatedResponse([1, 2, 3], 3, 1, 10);
		const mapped = page.map((value) => ({ value }));

		expect(mapped.data).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
		expect(mapped.meta).toEqual(page.meta);
	});
});

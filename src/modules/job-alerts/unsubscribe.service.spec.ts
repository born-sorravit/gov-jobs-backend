import { UnsubscribeService } from "@/modules/job-alerts/unsubscribe.service";
import { newUnsubscribeToken } from "@/shared/utils/unsubscribe-token";
import { NotFoundException } from "@nestjs/common";

interface Row {
	id: string;
	name: string;
	isActive: boolean;
	unsubscribeToken: string;
}

/** A one-row stand-in for the repository, so these assert behaviour and not SQL. */
const repositoryOf = (rows: Row[]) => {
	const update = jest.fn(async (id: string, changes: Partial<Row>) => {
		Object.assign(rows.find((row) => row.id === id) as Row, changes);
		return { affected: 1 };
	});

	return {
		update,
		findOne: async ({ where }: { where: { unsubscribeToken: string } }) =>
			rows.find((row) => row.unsubscribeToken === where.unsubscribeToken) ?? null,
	};
};

describe("UnsubscribeService", () => {
	const build = (isActive = true) => {
		const rows: Row[] = [
			{
				id: "alert-1",
				name: "นักวิชาการคอมพิวเตอร์",
				isActive,
				unsubscribeToken: "tok-1",
			},
			{
				id: "alert-2",
				name: "someone else's alert",
				isActive: true,
				unsubscribeToken: "tok-2",
			},
		];
		const repository = repositoryOf(rows);
		return {
			rows,
			repository,
			service: new UnsubscribeService(repository as never),
		};
	};

	describe("peek", () => {
		it("reads the alert without changing it", async () => {
			const { service, rows } = build();

			expect(await service.peek("tok-1")).toEqual({
				alertName: "นักวิชาการคอมพิวเตอร์",
				isActive: true,
			});
			// The whole reason GET and POST are separate handlers.
			expect(rows[0].isActive).toBe(true);
		});

		it("404s on an unknown token", async () => {
			const { service } = build();
			await expect(service.peek("nope")).rejects.toThrow(NotFoundException);
		});
	});

	describe("unsubscribe", () => {
		it("switches the alert off", async () => {
			const { service, rows } = build();

			expect(await service.unsubscribe("tok-1")).toEqual({
				alertName: "นักวิชาการคอมพิวเตอร์",
				changed: true,
			});
			expect(rows[0].isActive).toBe(false);
		});

		/** A mail client retrying its one-click POST must not see an error. */
		it("is idempotent", async () => {
			const { service, rows } = build();

			await service.unsubscribe("tok-1");
			expect(await service.unsubscribe("tok-1")).toEqual({
				alertName: "นักวิชาการคอมพิวเตอร์",
				changed: false,
			});
			expect(rows[0].isActive).toBe(false);
		});

		it("pauses rather than deletes, so the saved search survives", async () => {
			const { service, rows, repository } = build();

			await service.unsubscribe("tok-1");

			expect(repository.update).toHaveBeenCalledWith("alert-1", {
				isActive: false,
			});
			expect(rows).toHaveLength(2);
		});

		it("touches only the alert the token belongs to", async () => {
			const { service, rows } = build();

			await service.unsubscribe("tok-1");

			expect(rows[1].isActive).toBe(true);
		});

		/**
		 * 404 rather than 400/401 for everything unusable: the endpoint is public, and a
		 * response that told a prober "well-formed but unknown" would make it an oracle.
		 */
		it.each([
			["an unknown token", "nope"],
			["an empty token", ""],
			["whitespace", "   "],
		])("404s for %s", async (_label, token) => {
			const { service, rows } = build();

			await expect(service.unsubscribe(token)).rejects.toThrow(NotFoundException);
			expect(rows.every((row) => row.isActive)).toBe(true);
		});
	});
});

describe("newUnsubscribeToken", () => {
	it("is URL-safe so it survives a query string and a header", () => {
		expect(newUnsubscribeToken()).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("is long enough not to be guessed", () => {
		// 32 bytes base64url — 43 characters, no padding.
		expect(newUnsubscribeToken()).toHaveLength(43);
	});

	it("never repeats", () => {
		const tokens = new Set(Array.from({ length: 500 }, () => newUnsubscribeToken()));
		expect(tokens.size).toBe(500);
	});

	it("fits the column", () => {
		expect(newUnsubscribeToken().length).toBeLessThanOrEqual(64);
	});
});

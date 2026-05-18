import { ForkableClient } from "./forkable.js";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const SESSION_COOKIE = "test-session-cookie";

function mockGraphQL(data: unknown): void {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({ data }),
	});
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe("ForkableClient", () => {
	describe("getMenuForDate", () => {
		it("groups meals by restaurant and excludes disabled items", async () => {
			mockGraphQL({
				myDeliveries: [
					{
						id: 100,
						forDeliveryAt: "2026-02-19T12:00:00.000Z",
						isReadOnly: false,
						mealClubId: 3916,
						availableMenuIds: [10, 11],
						address: { formatted: "<address>" },
						club: { id: 3916, name: "NY" },
					},
				],
			});
			mockGraphQL({
				menus: [
					{
						id: 10,
						name: "menu-10",
						displayName: "Cafe Good",
						venue: { id: 200, name: "cafe-good", displayName: "Cafe Good" },
						sections: [
							{
								items: [
									{
										id: 501,
										menuId: 10,
										name: "Chicken Bowl",
										description: "Grain bowl",
										price: 18,
										averageRating: 4.7,
										disabled: false,
										ingredientTags: ["gluten-free"],
										modifiers: [],
									},
									{
										id: 599,
										menuId: 10,
										name: "Sold Out Meal",
										description: "",
										price: 14,
										averageRating: null,
										disabled: true,
										ingredientTags: [],
										modifiers: [],
									},
								],
							},
						],
					},
					{
						id: 11,
						name: "menu-11",
						displayName: "Cafe Good",
						venue: { id: 200, name: "cafe-good", displayName: "Cafe Good" },
						sections: [
							{
								items: [
									{
										id: 502,
										menuId: 11,
										name: "Tofu Bowl",
										description: "Tofu bowl",
										price: 17,
										averageRating: null,
										disabled: false,
										ingredientTags: ["vegan"],
										modifiers: [],
									},
								],
							},
						],
					},
				],
			});

			const client = new ForkableClient(SESSION_COOKIE);
			const result = await client.getMenuForDate("2026-02-19");

			expect(result).toMatchObject({
				date: "2026-02-19",
				deliveryCount: 1,
				restaurantCount: 1,
				mealCount: 2,
			});
			expect(result.deliveries[0]).toMatchObject({
				deliveryId: 100,
				locationId: 3916,
				locationName: "NY",
			});
			expect(result.deliveries[0].restaurants).toHaveLength(1);
			expect(result.deliveries[0].restaurants[0].restaurantName).toBe("Cafe Good");
			expect(result.deliveries[0].restaurants[0].meals).toHaveLength(2);
			expect(result.deliveries[0].restaurants[0].meals[0].name).toBe("Chicken Bowl");
			expect(result.deliveries[0].restaurants[0].meals[1].name).toBe("Tofu Bowl");
		});

		it("rejects invalid date format", async () => {
			const client = new ForkableClient(SESSION_COOKIE);
			await expect(client.getMenuForDate("02-19-2026")).rejects.toThrow("Invalid date");
		});

		it("returns empty results when no deliveries match", async () => {
			mockGraphQL({ myDeliveries: [] });

			const client = new ForkableClient(SESSION_COOKIE);
			const result = await client.getMenuForDate("2026-02-19");

			expect(result).toMatchObject({
				date: "2026-02-19",
				deliveryCount: 0,
				restaurantCount: 0,
				mealCount: 0,
				deliveries: [],
			});
		});
	});
});

import type { DayMenuResult } from "./forkable.js";
import { SlackClient } from "./slack.js";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const SLACK_TOKEN = "xoxb-test-token";

function mockSlackApi(data: Record<string, unknown>): void {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({ ok: true, ...data }),
	});
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe("SlackClient", () => {
	describe("postMenu", () => {
		it("posts a formatted menu message to the channel", async () => {
			mockSlackApi({ ts: "1234567890.123456", channel: "C123" });

			const menu: DayMenuResult = {
				date: "2026-05-18",
				deliveryCount: 1,
				restaurantCount: 1,
				mealCount: 2,
				deliveries: [
					{
						deliveryId: 100,
						date: "2026-05-18",
						locationId: 3916,
						locationName: "NY",
						restaurants: [
							{
								restaurantName: "Cafe Good",
								meals: [
									{
										mealId: 501,
										menuId: 10,
										name: "Chicken Bowl",
										description: "Grain bowl",
										price: 18,
										averageRating: 4.7,
										tags: ["gluten-free"],
										requiredSelections: [],
										hasOptionalSelections: false,
									},
									{
										mealId: 502,
										menuId: 11,
										name: "Tofu Bowl",
										description: "Tofu bowl",
										price: 17,
										averageRating: null,
										tags: ["vegan"],
										requiredSelections: [],
										hasOptionalSelections: false,
									},
								],
							},
						],
					},
				],
			};

			const client = new SlackClient(SLACK_TOKEN);
			const result = await client.postMenu("C123", menu);

			expect(result).toMatchObject({
				success: true,
				channelId: "C123",
				messageTs: "1234567890.123456",
			});

			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toBe("https://slack.com/api/chat.postMessage");

			const body = JSON.parse(options.body as string);
			expect(body.channel).toBe("C123");
			expect(body.text).toContain("Forkable Menu for 2026-05-18");
			expect(body.text).toContain("Chicken Bowl");
			expect(body.text).toContain("Tofu Bowl");
		});
	});

	describe("getRecentMessages", () => {
		it("reads channel messages and resolves user names", async () => {
			mockSlackApi({
				messages: [
					{ ts: "111", text: "Chicken Bowl: 5/5", user: "U123" },
					{ ts: "222", text: "Tofu Bowl was great", user: "U456" },
				],
			});
			// User lookups
			mockSlackApi({ user: { id: "U123", real_name: "Alice", name: "alice" } });
			mockSlackApi({ user: { id: "U456", real_name: "Bob", name: "bob" } });

			const client = new SlackClient(SLACK_TOKEN);
			const result = await client.getRecentMessages("C123", 10);

			expect(result.success).toBe(true);
			expect(result.messages).toHaveLength(2);
			expect(result.messages[0]).toMatchObject({
				text: "Chicken Bowl: 5/5",
				userName: "Alice",
			});
			expect(result.messages[1]).toMatchObject({
				text: "Tofu Bowl was great",
				userName: "Bob",
			});
		});

		it("reads thread replies when threadTs is provided", async () => {
			mockSlackApi({
				messages: [
					{ ts: "111", text: "Menu post", user: "U001" },
					{ ts: "222", text: "Rating: 4/5 for salad", user: "U123", thread_ts: "111" },
				],
			});
			mockSlackApi({ user: { id: "U123", real_name: "Alice", name: "alice" } });

			const client = new SlackClient(SLACK_TOKEN);
			const result = await client.getRecentMessages("C123", 10, "111");

			// Should exclude the parent message
			expect(result.messages).toHaveLength(1);
			expect(result.messages[0]).toMatchObject({
				text: "Rating: 4/5 for salad",
				userName: "Alice",
				isThreadReply: true,
			});
		});
	});
});

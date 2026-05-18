import { Worker, j } from "@notionhq/workers";
import type { DayMenuResult } from "./forkable.js";
import { ForkableClient } from "./forkable.js";
import type { GetMessagesResult, PostMenuResult } from "./slack.js";
import { SlackClient } from "./slack.js";

const worker = new Worker();
export default worker;

function getForkableClient(): ForkableClient {
	const sessionCookie = process.env.FORKABLE_SESSION_COOKIE;
	if (!sessionCookie) {
		throw new Error("FORKABLE_SESSION_COOKIE environment variable is required");
	}
	return new ForkableClient(sessionCookie);
}

function getSlackClient(): SlackClient {
	const token = process.env.SLACK_BOT_TOKEN;
	if (!token) {
		throw new Error("SLACK_BOT_TOKEN environment variable is required");
	}
	return new SlackClient(token);
}

function getSlackChannelId(): string {
	const channelId = process.env.SLACK_CHANNEL_ID;
	if (!channelId) {
		throw new Error("SLACK_CHANNEL_ID environment variable is required");
	}
	return channelId;
}

// --- Tool: Get today's Forkable menu ---

type GetMenuInput = {
	date: string;
	[key: string]: string;
};

worker.tool<GetMenuInput, DayMenuResult>("getMenuForDate", {
	title: "Get Menu For Date",
	description:
		"Returns every available Forkable restaurant and meal for a specific date (YYYY-MM-DD), grouped by delivery location. Includes meal names, prices, ratings, dietary tags, and descriptions.",
	schema: j.object({
		date: j.string().describe("The delivery date to inspect in YYYY-MM-DD format."),
	}),
	execute: async ({ date }) => {
		return getForkableClient().getMenuForDate(date);
	},
});

// --- Tool: Post menu to Slack ---

type PostMenuInput = {
	date: string;
	channelId: string | null;
	[key: string]: string | null;
};

worker.tool<PostMenuInput, PostMenuResult>("postMenuToSlack", {
	title: "Post Menu To Slack",
	description:
		"Fetches the Forkable menu for a date and posts it to a Slack channel with a formatted message. Uses the configured SLACK_CHANNEL_ID by default, or a custom channelId if provided.",
	schema: j.object({
		date: j.string().describe("The delivery date in YYYY-MM-DD format."),
		channelId: j
			.string()
			.nullable()
			.describe("Optional Slack channel ID. Uses the default channel if null."),
	}),
	execute: async ({ date, channelId }) => {
		const menu = await getForkableClient().getMenuForDate(date);
		return getSlackClient().postMenu(channelId ?? getSlackChannelId(), menu);
	},
});

// --- Tool: Get Slack messages (for the agent to parse ratings from) ---

type GetSlackMessagesInput = {
	channelId: string | null;
	limit: number | null;
	threadTs: string | null;
	[key: string]: string | number | null;
};

worker.tool<GetSlackMessagesInput, GetMessagesResult>("getSlackMessages", {
	title: "Get Slack Messages",
	description:
		"Reads recent messages from a Slack channel or a thread. Use this to find meal ratings that people have posted. If threadTs is provided, returns replies to that specific message thread (useful for reading replies to a posted menu). The agent should parse the returned messages to extract ratings.",
	schema: j.object({
		channelId: j
			.string()
			.nullable()
			.describe("Slack channel ID. Uses the default channel if null."),
		limit: j
			.number()
			.nullable()
			.describe("Max number of messages to retrieve. Defaults to 50."),
		threadTs: j
			.string()
			.nullable()
			.describe(
				"Thread timestamp to read replies from. Pass the ts from a posted menu message to get its replies.",
			),
	}),
	execute: async ({ channelId, limit, threadTs }) => {
		return getSlackClient().getRecentMessages(
			channelId ?? getSlackChannelId(),
			limit ?? 50,
			threadTs ?? undefined,
		);
	},
});

// --- Tool: Add a meal rating to a Notion database ---

type AddRatingInput = {
	mealName: string;
	restaurantName: string | null;
	rating: number;
	maxRating: number | null;
	date: string;
	reviewer: string | null;
	location: string | null;
	notes: string | null;
	[key: string]: string | number | null;
};

type AddRatingResult = {
	success: boolean;
	message: string;
	[key: string]: string | boolean;
};

worker.tool<AddRatingInput, AddRatingResult>("addMealRating", {
	title: "Add Meal Rating",
	description:
		"Adds a meal rating to the configured Notion ratings database. Call this for each rating extracted from Slack messages. The rating should be normalized to a 1-5 scale.",
	schema: j.object({
		mealName: j.string().describe("Name of the meal being rated."),
		restaurantName: j.string().nullable().describe("Name of the restaurant."),
		rating: j.number().describe("Rating value, normalized to 1-5 scale."),
		maxRating: j
			.number()
			.nullable()
			.describe("Original max rating if not on a 5-point scale, for reference."),
		date: j.string().describe("Date of the meal in YYYY-MM-DD format."),
		reviewer: j.string().nullable().describe("Name of the person who rated the meal."),
		location: j.string().nullable().describe("Office location (e.g., NY, SF)."),
		notes: j.string().nullable().describe("Any additional notes or comments about the meal."),
	}),
	execute: async (input) => {
		const databaseId = process.env.RATINGS_DATABASE_ID;
		if (!databaseId) {
			return {
				success: false,
				message: "RATINGS_DATABASE_ID environment variable is required",
			};
		}

		const notionToken = process.env.NOTION_API_TOKEN;
		if (!notionToken) {
			return {
				success: false,
				message: "NOTION_API_TOKEN environment variable is required",
			};
		}

		const properties: Record<string, unknown> = {
			"Meal Name": { title: [{ text: { content: input.mealName } }] },
			Rating: { number: input.rating },
			Date: { date: { start: input.date } },
		};

		if (input.restaurantName) {
			properties["Restaurant"] = {
				rich_text: [{ text: { content: input.restaurantName } }],
			};
		}
		if (input.reviewer) {
			properties["Reviewer"] = {
				rich_text: [{ text: { content: input.reviewer } }],
			};
		}
		if (input.location) {
			properties["Location"] = { select: { name: input.location } };
		}
		if (input.notes) {
			properties["Notes"] = {
				rich_text: [{ text: { content: input.notes } }],
			};
		}

		const response = await fetch("https://api.notion.com/v1/pages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${notionToken}`,
				"notion-version": "2022-06-28",
			},
			body: JSON.stringify({
				parent: { database_id: databaseId },
				properties,
			}),
		});

		if (!response.ok) {
			const body = await response.text();
			return {
				success: false,
				message: `Notion API error ${response.status}: ${body}`,
			};
		}

		return {
			success: true,
			message: `Added rating for "${input.mealName}" (${input.rating}/5) by ${input.reviewer ?? "anonymous"}`,
		};
	},
});

import { Worker, j } from "@notionhq/workers";
import type { DayMenuResult } from "./forkable.js";
import { ForkableClient } from "./forkable.js";
import type { CollectRatingsResult, GetMessagesResult, PostMenuResult } from "./slack.js";
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
	return process.env.SLACK_CHANNEL_ID ?? "C0B3G887R6X";
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

// --- Tool: Collect "RateThis" messages from Slack ---

type CollectRatingsInput = {
	channelId: string | null;
	limit: number | null;
	threadTs: string | null;
	[key: string]: string | number | null;
};

worker.tool<CollectRatingsInput, CollectRatingsResult>("collectRatings", {
	title: "Collect Ratings From Slack",
	description:
		'Scans recent Slack messages for the keyword "RateThis" (any casing: ratethis, RATETHIS, rateThis, etc.). Returns only matching messages with the keyword stripped, the user\'s name, and a permalink to the Slack message. The agent should parse each ratingText to extract the dish name, rating, and any notes, then call addMealRating for each.',
	schema: j.object({
		channelId: j
			.string()
			.nullable()
			.describe("Slack channel ID. Uses the default channel if null."),
		limit: j
			.number()
			.nullable()
			.describe("Max messages to scan. Defaults to 100."),
		threadTs: j
			.string()
			.nullable()
			.describe("Thread timestamp to scan replies from, or null for the main channel."),
	}),
	execute: async ({ channelId, limit, threadTs }) => {
		return getSlackClient().getRatingMessages(
			channelId ?? getSlackChannelId(),
			limit ?? 100,
			threadTs ?? undefined,
		);
	},
});

// --- Tool: Add a meal rating to the Forkable Food Tracker database ---

const STAR_RATINGS: Record<number, string> = {
	1: "⭐ 1 Star",
	2: "⭐⭐ 2 Stars",
	3: "⭐⭐⭐ 3 Stars",
	4: "⭐⭐⭐⭐ 4 Stars",
	5: "⭐⭐⭐⭐⭐ 5 Stars",
};

type AddRatingInput = {
	dishName: string;
	restaurantName: string | null;
	rating: number;
	date: string;
	cuisineType: string | null;
	wouldOrderAgain: boolean | null;
	notes: string | null;
	slackLink: string | null;
	[key: string]: string | number | boolean | null;
};

type AddRatingResult = {
	success: boolean;
	message: string;
	[key: string]: string | boolean;
};

worker.tool<AddRatingInput, AddRatingResult>("addMealRating", {
	title: "Add Meal Rating",
	description:
		"Adds a meal rating to the Forkable Food Tracker Notion database. Call this for each rating extracted from Slack messages. Rating must be 1-5 (integer). Matches the existing database schema: Dish Name (title), Rating (select: 1-5 stars), Restaurant, Date Tried, Cuisine Type, Would Order Again, Notes, Slack Link.",
	schema: j.object({
		dishName: j.string().describe("Name of the dish being rated."),
		restaurantName: j.string().nullable().describe("Name of the restaurant."),
		rating: j
			.number()
			.describe("Rating from 1 to 5 (integer). Will be mapped to the star select options."),
		date: j.string().describe("Date the meal was tried in YYYY-MM-DD format."),
		cuisineType: j
			.string()
			.nullable()
			.describe(
				"Cuisine type. One of: Italian, Japanese, Mexican, American, Thai, Indian, Chinese, Mediterranean, French, Korean.",
			),
		wouldOrderAgain: j
			.boolean()
			.nullable()
			.describe("Whether the person would order this dish again."),
		notes: j.string().nullable().describe("Any additional notes or comments about the meal."),
		slackLink: j.string().nullable().describe("Link to the Slack message with the rating."),
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

		const starRating = STAR_RATINGS[Math.round(Math.max(1, Math.min(5, input.rating)))];
		if (!starRating) {
			return {
				success: false,
				message: `Invalid rating ${input.rating}. Must be 1-5.`,
			};
		}

		const properties: Record<string, unknown> = {
			"Dish Name": { title: [{ text: { content: input.dishName } }] },
			Rating: { select: { name: starRating } },
			"Date Tried": { date: { start: input.date } },
		};

		if (input.restaurantName) {
			properties["Restaurant"] = {
				rich_text: [{ text: { content: input.restaurantName } }],
			};
		}
		if (input.cuisineType) {
			properties["Cuisine Type"] = { select: { name: input.cuisineType } };
		}
		if (input.wouldOrderAgain != null) {
			properties["Would Order Again"] = { checkbox: input.wouldOrderAgain };
		}
		if (input.notes) {
			properties["Notes"] = {
				rich_text: [{ text: { content: input.notes } }],
			};
		}
		if (input.slackLink) {
			properties["Slack Link"] = { url: input.slackLink };
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
			message: `Added rating for "${input.dishName}" (${starRating}) to Forkable Food Tracker`,
		};
	},
});

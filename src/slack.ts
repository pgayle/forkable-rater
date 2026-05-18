import type { DayMenuResult } from "./forkable.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const SLACK_API_URL = "https://slack.com/api";

interface SlackResponse {
	ok: boolean;
	error?: string;
}

interface SlackPostMessageResponse extends SlackResponse {
	ts?: string;
	channel?: string;
}

interface SlackMessage {
	ts: string;
	text: string;
	user?: string;
	thread_ts?: string;
}

interface SlackConversationsHistoryResponse extends SlackResponse {
	messages?: SlackMessage[];
	has_more?: boolean;
}

interface SlackConversationsRepliesResponse extends SlackResponse {
	messages?: SlackMessage[];
	has_more?: boolean;
}

interface SlackUserInfo {
	id: string;
	real_name: string;
	name: string;
}

interface SlackUserInfoResponse extends SlackResponse {
	user?: SlackUserInfo;
}

export interface SlackMessageInfo {
	ts: string;
	text: string;
	userId: string | null;
	userName: string | null;
	isThreadReply: boolean;
	[key: string]: JsonValue;
}

export interface PostMenuResult {
	success: boolean;
	message: string;
	channelId: string;
	messageTs: string | null;
	[key: string]: JsonValue;
}

export interface GetMessagesResult {
	success: boolean;
	message: string;
	channelId: string;
	messages: SlackMessageInfo[];
	[key: string]: JsonValue;
}

function formatMenuForSlack(menu: DayMenuResult): string {
	if (menu.mealCount === 0) {
		return `📋 *No meals available for ${menu.date}*`;
	}

	const lines: string[] = [
		`🍽️ *Forkable Menu for ${menu.date}*`,
		`${menu.mealCount} meals from ${menu.restaurantCount} restaurants`,
		"",
	];

	for (const delivery of menu.deliveries) {
		lines.push(`📍 *${delivery.locationName}*`);

		for (const restaurant of delivery.restaurants) {
			lines.push(`\n*${restaurant.restaurantName}*`);

			for (const meal of restaurant.meals) {
				const price = `$${meal.price.toFixed(2)}`;
				const rating = meal.averageRating != null ? ` ⭐${meal.averageRating}` : "";
				const tags = meal.tags.length > 0 ? ` (${meal.tags.join(", ")})` : "";
				lines.push(`• ${meal.name} — ${price}${rating}${tags}`);
				if (meal.description) {
					lines.push(`  _${meal.description}_`);
				}
			}
		}

		lines.push("");
	}

	lines.push("_Reply to this message with your ratings! e.g. \"Chicken Bowl: 4/5\"_");
	return lines.join("\n");
}

export class SlackClient {
	constructor(
		private readonly botToken: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	private async slackApi<T extends SlackResponse>(
		method: string,
		body: Record<string, unknown>,
	): Promise<T> {
		const response = await this.fetchImpl(`${SLACK_API_URL}/${method}`, {
			method: "POST",
			headers: {
				"content-type": "application/json; charset=utf-8",
				authorization: `Bearer ${this.botToken}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`Slack API ${method} failed: ${response.status} ${response.statusText}`);
		}

		const result = (await response.json()) as T;
		if (!result.ok) {
			throw new Error(`Slack API ${method} error: ${result.error ?? "unknown"}`);
		}
		return result;
	}

	async postMenu(channelId: string, menu: DayMenuResult): Promise<PostMenuResult> {
		const text = formatMenuForSlack(menu);
		const result = await this.slackApi<SlackPostMessageResponse>("chat.postMessage", {
			channel: channelId,
			text,
			unfurl_links: false,
		});

		return {
			success: true,
			message: `Posted menu for ${menu.date} to Slack`,
			channelId,
			messageTs: result.ts ?? null,
		};
	}

	async getRecentMessages(
		channelId: string,
		limit: number = 50,
		threadTs?: string,
	): Promise<GetMessagesResult> {
		let messages: SlackMessage[];

		if (threadTs) {
			const result = await this.slackApi<SlackConversationsRepliesResponse>(
				"conversations.replies",
				{ channel: channelId, ts: threadTs, limit },
			);
			messages = (result.messages ?? []).filter((m) => m.ts !== threadTs);
		} else {
			const result = await this.slackApi<SlackConversationsHistoryResponse>(
				"conversations.history",
				{ channel: channelId, limit },
			);
			messages = result.messages ?? [];
		}

		const userCache = new Map<string, string>();
		const resolvedMessages: SlackMessageInfo[] = [];

		for (const msg of messages) {
			let userName: string | null = null;
			if (msg.user) {
				if (userCache.has(msg.user)) {
					userName = userCache.get(msg.user)!;
				} else {
					try {
						const userResult = await this.slackApi<SlackUserInfoResponse>(
							"users.info",
							{ user: msg.user },
						);
						userName = userResult.user?.real_name ?? userResult.user?.name ?? null;
						if (userName) {
							userCache.set(msg.user, userName);
						}
					} catch {
						// Skip user resolution if it fails
					}
				}
			}

			resolvedMessages.push({
				ts: msg.ts,
				text: msg.text,
				userId: msg.user ?? null,
				userName,
				isThreadReply: Boolean(msg.thread_ts),
			});
		}

		return {
			success: true,
			message: `Retrieved ${resolvedMessages.length} messages`,
			channelId,
			messages: resolvedMessages,
		};
	}
}

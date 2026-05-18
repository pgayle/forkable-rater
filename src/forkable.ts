const FORKABLE_API_URL = "https://forkable.com/api/v2/graphql";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string }>;
}

interface GraphQLDeliveriesResponse {
	myDeliveries: ForkableDelivery[];
}

interface GraphQLMenusResponse {
	menus: ForkableMenu[];
}

interface ForkableAddress {
	formatted: string;
}

interface ForkableClub {
	id: number;
	name: string;
}

interface ForkableDelivery {
	id: number;
	forDeliveryAt: string;
	isReadOnly: boolean;
	mealClubId: number;
	availableMenuIds: number[];
	address: ForkableAddress;
	club: ForkableClub;
}

interface ForkableModifierOption {
	id: number;
	name: string;
	price: number;
}

interface ForkableModifier {
	id: number;
	name: string;
	required: boolean;
	hidden?: boolean;
	options: ForkableModifierOption[];
}

interface ForkableMenuItem {
	id: number;
	menuId: number;
	name: string;
	description: string;
	price: number;
	averageRating: number | null;
	disabled: boolean;
	ingredientTags: string[];
	modifiers: ForkableModifier[];
}

interface ForkableMenuSection {
	items: ForkableMenuItem[];
}

interface ForkableVenue {
	id: number;
	name: string;
	displayName: string;
}

interface ForkableMenu {
	id: number;
	name: string;
	displayName: string;
	venue: ForkableVenue;
	sections: ForkableMenuSection[];
}

export interface MealInfo {
	mealId: number;
	menuId: number;
	name: string;
	description: string;
	price: number;
	averageRating: number | null;
	tags: string[];
	requiredSelections: string[];
	hasOptionalSelections: boolean;
	[key: string]: JsonValue;
}

export interface RestaurantMeals {
	restaurantName: string;
	meals: MealInfo[];
	[key: string]: JsonValue;
}

export interface DeliveryMeals {
	deliveryId: number;
	date: string;
	locationId: number;
	locationName: string;
	restaurants: RestaurantMeals[];
	[key: string]: JsonValue;
}

export interface DayMenuResult {
	date: string;
	deliveryCount: number;
	restaurantCount: number;
	mealCount: number;
	deliveries: DeliveryMeals[];
	[key: string]: JsonValue;
}

function isIsoDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function assertIsoDate(date: string): void {
	if (!isIsoDate(date)) {
		throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD.`);
	}
}

function deliveryDate(delivery: ForkableDelivery): string {
	return delivery.forDeliveryAt.slice(0, 10);
}

function locationName(delivery: ForkableDelivery): string {
	return delivery.club.name || delivery.address.formatted;
}

function mealToInfo(item: ForkableMenuItem): MealInfo {
	return {
		mealId: item.id,
		menuId: item.menuId,
		name: item.name,
		description: (item.description ?? "").trim(),
		price: item.price,
		averageRating: item.averageRating,
		tags: item.ingredientTags ?? [],
		requiredSelections: (item.modifiers ?? [])
			.filter((m) => !m.hidden && m.required)
			.map((m) => {
				const options = m.options.map((o) => o.name).join(" | ");
				return `${m.name}: ${options}`;
			}),
		hasOptionalSelections: (item.modifiers ?? []).some((m) => !m.hidden && !m.required),
	};
}

function summarizeDelivery(delivery: ForkableDelivery, menus: ForkableMenu[]): DeliveryMeals {
	const restaurantMap = new Map<string, RestaurantMeals>();

	for (const menu of menus) {
		const restaurantName = menu.venue.displayName || menu.venue.name;
		let restaurant = restaurantMap.get(restaurantName);
		if (!restaurant) {
			restaurant = { restaurantName, meals: [] };
			restaurantMap.set(restaurantName, restaurant);
		}

		for (const section of menu.sections ?? []) {
			for (const item of section.items ?? []) {
				if (item.disabled) continue;
				restaurant.meals.push(mealToInfo(item));
			}
		}
	}

	const restaurants = [...restaurantMap.values()]
		.map((r) => ({
			...r,
			meals: [...r.meals].sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));

	return {
		deliveryId: delivery.id,
		date: deliveryDate(delivery),
		locationId: delivery.mealClubId,
		locationName: locationName(delivery),
		restaurants,
	};
}

export class ForkableClient {
	constructor(
		private readonly sessionCookie: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	private async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
		const response = await this.fetchImpl(FORKABLE_API_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				origin: "https://forkable.com",
				"forkable-referrer": "mc",
				cookie: `_easyorder_session=${this.sessionCookie}`,
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!response.ok) {
			throw new Error(`Forkable API request failed: ${response.status} ${response.statusText}`);
		}

		const result = (await response.json()) as GraphQLResponse<T>;
		if (result.errors?.length) {
			throw new Error(result.errors.map((e) => e.message).join("; "));
		}
		if (!result.data) {
			throw new Error("Forkable API returned no data");
		}
		return result.data;
	}

	async getDeliveries(from: string): Promise<ForkableDelivery[]> {
		assertIsoDate(from);
		const data = await this.graphql<GraphQLDeliveriesResponse>(
			`
				query Deliveries($from: Date!) {
					myDeliveries(from: $from) {
						id
						forDeliveryAt
						isReadOnly
						mealClubId
						availableMenuIds
						address { formatted }
						club { id name }
					}
				}
			`,
			{ from },
		);
		return data.myDeliveries;
	}

	async getMenus(menuIds: number[], clubId: number): Promise<ForkableMenu[]> {
		if (menuIds.length === 0) return [];
		const data = await this.graphql<GraphQLMenusResponse>(
			`
				query Menus($menuIds: [Int!]!, $clubId: Int!) {
					menus(ids: $menuIds, clubId: $clubId) {
						id
						name
						displayName
						venue { id name displayName }
						sections {
							items {
								id
								menuId
								name
								description
								price
								averageRating
								disabled
								ingredientTags
								modifiers {
									id
									name
									required
									hidden
									options { id name price }
								}
							}
						}
					}
				}
			`,
			{ menuIds, clubId },
		);
		return data.menus;
	}

	async getMenuForDate(date: string): Promise<DayMenuResult> {
		assertIsoDate(date);
		const deliveries = await this.getDeliveries(date);
		const matching = deliveries.filter((d) => deliveryDate(d) === date);
		const menuSets = await Promise.all(
			matching.map((d) => this.getMenus(d.availableMenuIds, d.mealClubId)),
		);

		const summarized = matching
			.map((d, i) => summarizeDelivery(d, menuSets[i]))
			.sort((a, b) => a.locationName.localeCompare(b.locationName));

		const restaurantCount = summarized.reduce((n, d) => n + d.restaurants.length, 0);
		const mealCount = summarized.reduce(
			(n, d) => n + d.restaurants.reduce((m, r) => m + r.meals.length, 0),
			0,
		);

		return {
			date,
			deliveryCount: summarized.length,
			restaurantCount,
			mealCount,
			deliveries: summarized,
		};
	}
}

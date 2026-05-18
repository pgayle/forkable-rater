# forkable-rater

A Notion Worker that posts daily Forkable lunch menus to Slack and collects meal ratings back into a Notion database.

## What It Does

1. **Morning menu post** — Fetches the day's available meals from Forkable (restaurants, prices, dietary tags, descriptions) and posts a formatted summary to your Slack channel.
2. **Rating collection** — Reads replies and messages from Slack where people rate their meals, then stores each rating in a Notion database for tracking over time.

## Tools

### `getMenuForDate`

Fetches every available Forkable restaurant and meal for a specific date, grouped by delivery location.

```json
{ "date": "2026-05-19" }
```

### `postMenuToSlack`

Fetches the menu and posts it to Slack as a formatted message.

```json
{ "date": "2026-05-19", "channelId": null }
```

### `getSlackMessages`

Reads recent messages from a Slack channel or thread. The agent uses this to find and parse meal ratings from Slack.

```json
{ "channelId": null, "limit": 50, "threadTs": "1234567890.123456" }
```

### `addMealRating`

Adds a meal rating to the Forkable Food Tracker Notion database.

```json
{
  "dishName": "Chicken Bowl",
  "restaurantName": "Cafe Good",
  "rating": 4,
  "date": "2026-05-19",
  "cuisineType": "American",
  "wouldOrderAgain": true,
  "notes": "Great flavors, slightly cold",
  "slackLink": null
}
```

## Notion Database Schema

Uses the existing **Forkable Food Tracker** database with these properties:

| Property         | Type     | Description                                        |
|------------------|----------|----------------------------------------------------|
| Dish Name        | Title    | Name of the dish                                   |
| Rating           | Select   | Star rating (⭐ 1 Star through ⭐⭐⭐⭐⭐ 5 Stars) |
| Restaurant       | Text     | Restaurant name                                    |
| Date Tried       | Date     | Date the meal was tried                            |
| Cuisine Type     | Select   | Italian, Japanese, Mexican, etc.                   |
| Submitted By     | Person   | Who submitted the rating                           |
| Would Order Again| Checkbox | Whether they'd order again                         |
| Notes            | Text     | Additional comments                                |
| Slack Link       | URL      | Link to the Slack rating message                   |

## Environment Variables

| Variable                  | Required | Description                                        |
|---------------------------|----------|----------------------------------------------------|
| `FORKABLE_SESSION_COOKIE` | Yes      | Your Forkable `_easyorder_session` cookie value    |
| `SLACK_BOT_TOKEN`         | Yes      | Slack bot token with `chat:write`, `channels:history`, `users:read` scopes |
| `SLACK_CHANNEL_ID`        | Yes      | Default Slack channel ID for posting menus         |
| `RATINGS_DATABASE_ID`     | Yes      | Notion database ID for storing ratings             |
| `NOTION_API_TOKEN`        | Yes      | Notion integration token with database write access |

## Local Setup

```bash
npm install
```

Create a `.env` file:

```
FORKABLE_SESSION_COOKIE=your_cookie_value
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL_ID=C0123456789
RATINGS_DATABASE_ID=your-database-id
NOTION_API_TOKEN=ntn_your-token
```

Validate:

```bash
npm run check
npm test
npm run build
```

## Deploying

Create a `workers.json` (gitignored):

```json
{
  "version": "1",
  "environment": "dev",
  "workspaceId": "your-workspace-id"
}
```

Then deploy:

```bash
ntn workers deploy
```

Make sure all environment variables are configured in your worker's deployed environment.

## Typical Agent Flow

1. **Morning (scheduled or manual trigger):**
   - Agent calls `getMenuForDate` with today's date
   - Agent calls `postMenuToSlack` to send the menu to the team channel

2. **After lunch (scheduled or manual trigger):**
   - Agent calls `getSlackMessages` with the menu message's `threadTs` to read replies
   - Agent parses ratings from the message text (it understands natural language: "4/5", "⭐⭐⭐⭐", "loved it", etc.)
   - Agent calls `addMealRating` for each rating found

## Credits

Forkable API integration adapted from [emmaguo13/forkable-worker](https://github.com/emmaguo13/forkable-worker).

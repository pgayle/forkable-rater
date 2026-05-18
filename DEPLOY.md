# Deployment Guide

## Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** → **From scratch**
2. Name it something like `Forkable Rater` and pick your workspace
3. Go to **OAuth & Permissions** in the sidebar
4. Under **Bot Token Scopes**, add these scopes:
   - `chat:write` — post menu messages
   - `channels:history` — read channel messages
   - `channels:read` — list channels
   - `users:read` — resolve user IDs to names
5. Click **Install to Workspace** at the top and approve
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — you'll need this as `SLACK_BOT_TOKEN`
7. **Invite the bot to #nedap-agentified**: in Slack, go to the channel and type `/invite @Forkable Rater`

## Step 2: Get Your Forkable Session Cookie

1. Log in to [forkable.com](https://forkable.com) in your browser
2. Open DevTools → Application → Cookies → `forkable.com`
3. Find the cookie named `_easyorder_session`
4. Copy its **value** (just the value, not the name) — this is your `FORKABLE_SESSION_COOKIE`

> ⚠️ This cookie expires when your Forkable session ends. You'll need to refresh it periodically.

## Step 3: Create workers.json

In the repo root, create a `workers.json` file (this is gitignored):

```json
{
  "version": "1",
  "environment": "dev",
  "workspaceId": "<your-notion-workspace-id>"
}
```

To find your workspace ID: go to any Notion page → the URL contains the workspace ID, or run `ntn login` and it will show your workspaces.

## Step 4: Deploy the Worker

```bash
# Install dependencies and build
npm install
npm run build

# Deploy to Notion
ntn workers deploy --name forkable-rater
```

After the first deploy, a `workerId` will be added to your `workers.json`. Future deploys just need:

```bash
ntn workers deploy
```

## Step 5: Set Environment Variables

```bash
# Forkable auth
ntn workers env set FORKABLE_SESSION_COOKIE=<your-cookie-value>

# Slack
ntn workers env set SLACK_BOT_TOKEN=xoxb-your-bot-token

# Notion database (Forkable Food Tracker)
ntn workers env set RATINGS_DATABASE_ID=364b35e6-e67f-80cb-b01a-eed7de1eb1bb
ntn workers env set NOTION_API_TOKEN=<your-notion-integration-token>
```

The `SLACK_CHANNEL_ID` defaults to `C0B3G887R6X` (#nedap-agentified) in the code, but you can override it:

```bash
ntn workers env set SLACK_CHANNEL_ID=C0B3G887R6X
```

## Step 6: Verify

Test the tools manually:

```bash
# Check the menu for today
ntn workers exec getMenuForDate '{"date": "2026-05-19"}'

# Post it to Slack
ntn workers exec postMenuToSlack '{"date": "2026-05-19", "channelId": null}'

# Scan for RateThis messages
ntn workers exec collectRatings '{"channelId": null, "limit": 100, "threadTs": null}'
```

## How People Use It

Once deployed, people in #nedap-agentified can rate meals by posting:

```
RateThis Chicken Bowl 4/5 amazing flavor
ratethis Salmon Plate 5/5
RATETHIS Tofu Bowl 2/5 - too bland, would not order again
```

The agent scans for these messages, parses the dish name/rating/notes, and adds each one to the [Forkable Food Tracker](https://app.dev.notion.com/p/364b35e6e67f80cbb01aeed7de1eb1bb) database in Notion.

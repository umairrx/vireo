# Vireo Discord Bot

A Discord bot that creates and manages "campaigns" inside a guild. Campaigns are posted as embeds with a join button; joining assigns a role and (optionally) gives access to a private category used for campaign-specific channels.

---

## Quick overview

- Entry: `bot.js`
- Persisted state: `campaigns.json` (simple JSON file; use a DB in production)
- Commands (slash):
  - `/create-campaign` — opens a modal or creates a campaign embed
  - `/close-campaign` — close a campaign by ID
  - `/campaign-stats` — show active campaigns stats
  - `/list-campaigns` — list all campaigns and IDs

---

## Prerequisites

- Node.js 18+ (recommended for discord.js v14)
- pnpm (recommended if you use the included `pnpm-lock.yaml`) or npm
- A Discord bot application with a bot token and the required intents & gateway permissions

---

## Required environment variables

Create a `.env` file in the project root with:

```
BOT_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id
GUILD_ID=optional_guild_id_for_dev_only
```

- `BOT_TOKEN` - required
- `CLIENT_ID` - required to register slash commands
- `GUILD_ID` - optional; when set, commands are registered only for that guild (faster during development)

---

## Install & run (local)

Using pnpm (recommended):

```bash
pnpm install --frozen-lockfile
pnpm start
```

Using npm:

```bash
npm install
npm start
```

`package.json` currently maps `start` to `node bot.js` so the bot runs in the foreground (good for Render / cloud providers).

---

## Render deploy (recommended configuration)

Build Command:

```bash
pnpm install --frozen-lockfile
```

Start Command:

```bash
pnpm start
```

Notes:

- Render manages restarts for processes that exit/crash. Using pm2 inside Render is unnecessary; if you prefer pm2, run it with `--no-daemon` in the start command.

Alternative (pm2):

- Add pm2 to dependencies: `pnpm add pm2`
- Start command:

```bash
pm2 start bot.js --no-daemon --name "vireo-bot"
```

---

## Bot permissions the bot should be invited with

The bot should have these permissions in the guild to work fully:

- Manage Roles
- Manage Channels
- Send Messages
- Embed Links
- Read Message History
- View Channels
- Use Slash Commands / Application Commands

If the bot lacks Manage Roles/Manage Channels, it will still post campaigns but cannot create categories or assign role access.

---

## Data schema (`campaigns.json`)

Each campaign is stored under its `campaignId` key. Example entry:

```json
"1623456789012": {
	"id": "1623456789012",
	"title": "Campaign Title",
	"description": "Full description",
	"messageId": "123456789012345678",
	"channelId": "123456789012345678",
	"participants": [
		{ "userId": "111", "username": "User#1234", "joinedAt": "...", "channelId": null, "roleId": "222" }
	],
	"createdAt": "2025-08-25T...",
	"active": true,
	"categoryId": "987654321098765432",
	"hasPrivateChannels": true
}
```

Notes:

- `categoryId` may be missing for campaigns created before category persistence was added.
- `participants` holds a snapshot of username at join time; usernames may change.

---

## Deep analysis — potential edge cases and recommendations

This section lists issues observed in `bot.js`, their impact, and recommended fixes.

1. Inconsistent category creation logic

- Where: `processCreateCampaign` and `createCampaign` both create categories but with different behavior: `processCreateCampaign` first searches for an existing category, `createCampaign` always creates a new category.
- Impact: Duplicate categories may be created, or permissions may not be applied if a category already existed. Campaigns created by the two flows may have different metadata saved.
- Recommendation: Consolidate category creation into a single helper (e.g., `ensureCategory(guild, name)`) that: checks cache & fetch, reuses existing, ensures bot overwrites, persists `categoryId`.

2. Race condition creating roles concurrently

- Where: `joinCampaign` checks for a role by name and creates it if not found. If multiple users join at the same time, both may not find the role and create duplicate roles.
- Impact: Multiple roles with the same name, inconsistent roleIds stored.
- Recommendation: After creating a role, re-check `guild.roles.cache` for an existing role with the same name and prefer the first found; or use a lightweight lock (memory-based) per campaign to serialize role creation. Better: use role name + campaign id to make names unique.

3. Missing or malformed categoryId handling

- Where: many places assume `campaign.categoryId` exists and that fetching the channel + message will succeed.
- Impact: If channel or message deleted, `closeCampaign` or permission edits may throw.
- Recommendation: Guard fetches with existence checks, and catch/handle NotFound errors. If message/channel missing, mark campaign accordingly and notify admins.

4. Permissions/privilege failures

- Where: creating categories, editing overwrites, creating roles, adding roles to member
- Impact: operations throw and are caught, but the user may not get clear feedback.
- Recommendation: Add a `/bot-audit` command or an admin check flow that reports current bot permissions and missing capabilities. When permission edits fail, send an ephemeral admin message suggesting required permissions.

5. Color parsing for embeds

- Where: `parseInt(embedColor, 16)` — this fails if the color string contains a `#` prefix or invalid hex.
- Impact: NaN errors cause embed creation to throw.
- Recommendation: Normalize color strings: strip leading `#`, validate hex length (3 or 6), fallback to default color on parse failure.

6. Logging bug in `logCampaignJoin`

- Where: Using `${user} (${user.tag})` — interpolating `user` object results in `[object Object]`.
- Impact: Log messages look wrong.
- Recommendation: Use `${user.tag}` and mention the user with `<@${user.id}>` where appropriate.

7. Use of magic numbers & event names

- Where: `this.client.once('ready', ...)` fixed from `clientReady` earlier. Setting activity type via numeric `3` is brittle.
- Recommendation: Use `ActivityType` or explicit strings from `discord.js` for activity.

8. Command permission & context checks

- Where: `handleSlashCommand` checks `interaction.member.permissions.has(...)` but doesn't check `interaction.inGuild()` or whether `interaction.member` is null.
- Impact: If a slash command is used outside a guild (rare) or member is undefined, it may throw.
- Recommendation: Early return with an informative message if `!interaction.inGuild()` or `!interaction.member`.

9. `campaign.participants` may grow unbounded

- Where: participants array stored forever; there is no removal or pruning.
- Impact: Large campaigns can cause big JSON and slower reads/writes.
- Recommendation: Add a retention policy and/or pagination for stats. Consider moving to a DB.

10. File write concurrency and atomicity

- Where: `saveCampaigns()` writes the entire file synchronously.
- Impact: Multiple concurrent writes may corrupt the file; sync writes block the event loop.
- Recommendation: Use append-only log, an actual DB, or at minimum write to a temp file and rename atomically. Prefer async writes and an in-memory queue if multiple writes happen.

11. Unexpected null `message.embeds[0]` in `closeCampaign`

- Where: `EmbedBuilder.from(message.embeds[0])` assumes an embed exists.
- Impact: If the message was edited or is non-embed, this will throw.
- Recommendation: Guard before using .from and handle gracefully.

12. Interaction checks duplicated

- Where: `interaction.isModalSubmit && interaction.isModalSubmit()` is redundant and confusing.
- Recommendation: Use a single method call as per discord.js docs: `interaction.isModalSubmit()`.

13. Command registration safety

- Where: No check that `BOT_TOKEN`/`CLIENT_ID` are present before calling Discord REST operations.
- Recommendation: Validate env variables at startup and fail early with clear message.

---

## Suggested code improvements (small, actionable)

- Add a helper `ensureCategory(guild, name)` to centralize behavior.
- Use a per-campaign lock (Map of Promise) during role creation to avoid duplicates.
- Replace synchronous file writes with atomic async writes.
- Validate inputs (embed color, custom options) and sanitize any user-provided strings.
- Add a simple `/bot-audit` command that reports bot permissions and list of missing permissions.
- Use `try { await this.registerCommands() } catch (err) { console.error(...); process.exit(1) }` to surface fatal config problems.
- Replace stringly-typed activity type (`3`) with `ActivityType.Listening` (imported from discord.js) for clarity.

---

## Troubleshooting

- If campaigns don't create categories: check bot has `Manage Channels` and `Manage Roles` at the guild level.
- If roles are created but members aren't added: check the bot's role position is above the role it's trying to assign (bots cannot assign roles higher than their own role).
- If commands fail to register: ensure `CLIENT_ID` and `BOT_TOKEN` are set and that the token is valid.
- If permission edits throw `Missing Permissions`: verify the bot's role has the required guild permissions and is high enough in role hierarchy.

---

## Quick development checklist

- [ ] Add `.env` with required keys
- [ ] Install deps: `pnpm install` or `npm install`
- [ ] Run locally: `pnpm start` or `node bot.js`
- [ ] Test flows: create campaign, join as multiple users simultaneously, close campaign.

---

## Contact / Next steps

If you'd like, I can:

- Implement the `ensureCategory` helper and consolidate category logic.
- Add atomic async writes for `saveCampaigns()`.
- Add a `/bot-audit` command and a small CI smoke-test for the flows.

---

README created by automated analysis. Review the recommendations and tell me which improvements you want implemented first.

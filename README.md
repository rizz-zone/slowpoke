# slowpoke

Discord bot for mirroring incident.io status pages into Discord, deployed on
Cloudflare Workers.

## Repository structure

| Path | Description |
| --- | --- |
| `src/index.ts` | Worker entrypoint for Discord interactions and scheduled sync |
| `src/commands` | Slash command definitions and registration handlers |
| `src/status` | incident.io fetch logic and Discord channel/message syncing |
| `src/db` | D1 schema and migrations |
| `src/durable` | Durable Object state for in-progress registrations |
| `utils/register.ts` | Script for registering slash commands with Discord |

## What it does

Once installed in a server, slowpoke can:

- validate Discord interaction webhooks directly in a Worker
- let admins run `/register_server` with an incident.io status-page domain
- create or reuse a category for tracked status channels
- create a voice channel whose name reflects current overall status
- create a voice channel whose name reflects the tracked domain
- create an `incidents` text channel containing live incident cards
- poll the tracked status pages every 2 minutes using a cron trigger
- update existing incident messages instead of reposting duplicates
- expire incomplete registration sessions after 24 hours
- optionally require a Discord consumable SKU before a server can register

## Setup

> [!TIP]
> This project assumes you already have a Discord application and are
> comfortable deploying Workers on Cloudflare. The moving pieces are fairly
> small, but you do need Discord bot setup, a D1 database, and a public Worker
> URL before the bot is usable.

### Prepare

The [.env.example](./.env.example) file shows the runtime values the project
expects. You will need:

- a Discord application ID
- a Discord bot token
- a Discord interaction public key
- a Cloudflare account with Workers, Durable Objects, and D1 enabled

Environment variables used by the project:

- `DISCORD_PUBLIC_KEY`: used to verify incoming Discord interaction requests
- `DISCORD_APPLICATION_ID`: Discord application ID for webhook edits and command registration
- `DISCORD_BOT_TOKEN`: bot token used to create channels, edit messages, and register commands
- `DISCORD_GUILD_ID`: optional; if set, `bun run register` registers commands to one guild immediately instead of globally
- `DISCORD_CONSUMABLE_SKU`: optional; if set, registration requires a matching unused consumable entitlement unless the user is exempt
- `ALWAYS_FREE_USERS`: optional JSON array of Discord user IDs allowed to bypass SKU checks

Cloudflare resources expected by `wrangler.jsonc`:

- a D1 database bound as `GLOBAL_DB`
- a Durable Object namespace bound as `PENDING_REGISTRATION`
- the scheduled trigger `*/2 * * * *`

Before first deploy, create the D1 database and ensure `wrangler.jsonc` points at
the correct database ID if you are not using the default name.

### Deploy

> [!CAUTION]
> slowpoke only works once Discord can reach your deployed Worker over HTTPS.
> Local development alone is not enough: the interactions endpoint in your
> Discord application settings must point to the public Worker URL.

The simplest deployment flow is:

1. Install dependencies with `bun install`.
2. Create the D1 database referenced by `wrangler.jsonc`.
3. Apply migrations with `bun run migrate` or `bunx wrangler d1 migrations apply <your-db-name> --remote`.
4. Deploy the Worker with `bunx wrangler deploy`.
5. Set the Discord application's **Interactions Endpoint URL** to your deployed Worker URL.
6. Add the bot to your server with permissions to create/manage channels and send messages.
7. Register slash commands with `bun run register`.

If you use Cloudflare Workers Builds, a practical configuration is:

- Root directory: `/`
- Build command: `bun install --frozen-lockfile && bun run build`
- Deploy command: `bunx wrangler deploy`

Set runtime secrets such as `DISCORD_BOT_TOKEN` and `DISCORD_PUBLIC_KEY` in the
Cloudflare dashboard or via Wrangler secrets before testing the bot.

> [!NOTE]
> `bun run build` is a dry-run Wrangler build that writes output to `dist/`.
> Actual deployment still needs `wrangler deploy`.

### Verify

Check whether it worked with the following flow:

1. Run `/ping` in a Discord server where the bot is installed.
2. Run `/register_server` and provide an incident.io status-page domain such as `status.example.com`.
3. Confirm that slowpoke creates or reuses a category and adds the status voice channel, domain voice channel, and `incidents` text channel.
4. Wait for a scheduled sync or trigger a real status change to confirm channel names and incident cards update correctly.

## Local development

This repository is set up around [Bun](https://bun.sh/), including the lockfile
and CI workflow.

To install dependencies and start the Worker locally:

```bash
bun install
bun run dev
```

To register slash commands while developing:

```bash
bun run register
```

To generate or apply database changes:

```bash
bun run generate
bun run migrate
```

To check code quality, use:

```bash
bun run check-types
bun run lint
bun run style
bun run build
```

## Contributions

Contributions are welcome. Keep changes focused, ensure the Worker still builds,
and include any required migration changes when touching the D1 schema.

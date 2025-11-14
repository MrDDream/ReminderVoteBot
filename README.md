# ReminderVoteBot

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?style=flat&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat&logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-0db7ed?style=flat&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

[Consulter la version FR](README.fr.md)

ReminderVoteBot is a production-ready Discord bot that nudges your community to vote via DMs or channel mentions. Each subscriber can pick custom time windows, time zones, delivery mode, and the vote URL to open. Perfect for Top-Serveurs (and similar) leaderboards where consistent vote cadence matters.

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture At A Glance](#architecture-at-a-glance)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [npm Scripts](#npm-scripts)
- [Discord Slash Commands](#discord-slash-commands)
- [Reminder Lifecycle](#reminder-lifecycle)
- [Data Persistence](#data-persistence)
- [Docker Deployment](#docker-deployment)
- [HTTP Helper & Vote Tracking](#http-helper--vote-tracking)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Overview
The bot stores subscriptions in `data/subscriptions.json`, keeps vote URL metadata in `data/config.json`, and schedules reminders with `node-cron`. Every user can:
- Select the vote entry (multiple URLs per guild supported).
- Define a daily reminder window (30-minute granularity) and time zone.
- Choose whether reminders arrive via DM or a dedicated channel ping.

Admins manage everything through Discord slash commands�no manual JSON edits required.

## Key Features
- Per-user reminders with adjustable windows, time zones, delivery mode, and per-entry cooldowns.
- `Vote now` button plus `Reset timer` button that immediately marks a vote without leaving Discord.
- Multi-server friendly: add as many vote URLs as you like, each with its own channel target + cooldown.
- Optional forced delivery mode via `FORCE_DELIVERY_MODE` (DM or channel) with automatic DM fallback when channel delivery fails.
- Built-in localization (`BOT_LANG = fr|en`) so the whole flow stays consistent in your preferred language.
- Lightweight Express server that powers `/health` and signed `/v?t=...` redirects for tracking clicks through a public domain.
- Docker Compose shipping with a persistent `bot_data` volume so state survives container restarts.

## Architecture At A Glance
| Component | Description |
| --- | --- |
| `src/index.js` | Main runtime: Discord interactions, scheduling logic, redirect endpoints. |
| `src/deploy-commands.js` | Publishes slash commands globally or per guild. |
| `src/config.js` | Loads/saves `data/config.json`, seeds defaults from `.env`. |
| `src/storage.js` | Manages subscription storage (schema v4) and legacy migrations. |
| `docker-compose.yml` | Single `bot` service with `bot_data` volume + HTTP port mapping. |
| `Dockerfile` | Node 20 Alpine base image installing production deps only. |
| `data/` | Auto-created storage directory for config + subscriptions (pretty JSON). |

## Requirements
- Node.js 18+ (or any compatible runtime inside Docker).
- Discord application with a bot invited to your server using the `bot` and `applications.commands` scopes.
- Permissions: `Send Messages`, `Manage Messages`, `Use Slash Commands`, and `Send Messages in Threads` if you ping threads/channels.
- Optional: a public domain if you want signed redirect tracking via `PUBLIC_BASE_URL`.

## Quick Start
```bash
git clone https://github.com/<your-org>/ReminderVoteBot.git
cd ReminderVoteBot
npm install
cp .env.example .env    # create the file manually if no template is provided
```
1. Fill in all required env vars (see table below).
2. Deploy the slash commands:
   ```bash
   npm run deploy:commands
   ```
   - With `GUILD_ID`, commands appear instantly on that server.
   - Without `GUILD_ID`, allow up to 1 hour for global propagation.
3. Start the bot:
   ```bash
   npm start
   ```

## Environment Variables
| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token (Bot tab on the developer portal). |
| `CLIENT_ID` | Yes | Application/client ID (General Information tab). |
| `GUILD_ID` | Optional | Server ID for instant command deployment (leave empty for global). |
| `DEFAULT_VOTE_URL` | Optional | Seed vote URL on first launch; can be replaced later via `/addvote`. |
| `DEFAULT_TZ` | Optional | Default timezone (e.g., `Europe/Paris`). |
| `BOT_LANG` | Optional | `fr` or `en` string controlling all bot messages. |
| `FORCE_DELIVERY_MODE` | Optional | Force `dm` or `channel` for new subscriptions. |
| `PUBLIC_BASE_URL` | Optional | Public domain (https://vote.example.com) that serves signed redirects. |
| `MARK_SECRET` | Optional | HMAC secret for redirect tokens (required if `PUBLIC_BASE_URL` is set). |
| `PORT` | Optional | Express HTTP port (`3000` by default). |

Notes:
- `DEFAULT_*` values only seed `data/config.json` the first time. Update the config later via `/listvote` or by editing the file.
- Secrets such as `DISCORD_TOKEN` and `MARK_SECRET` should never be committed to version control.

## npm Scripts
| Script | Purpose |
| --- | --- |
| `npm start` | Boots the Discord client and Express server. |
| `npm run deploy:commands` | Publishes or refreshes slash commands through the Discord REST API. |

## Discord Slash Commands
| Command | Purpose |
| --- | --- |
| `/subscribe` | Interactive flow to pick vote entry, reminder window (30-min steps), and delivery mode, then confirm. |
| `/unsubscribe` | Remove every reminder or a specific subscription via a select menu. |
| `/status` | Shows a detailed summary of your subscriptions, and lets you edit or delete one. |
| `/addvote` | (Requires Manage Guild) Modal to add a vote URL: label, URL, cooldown (minutes), optional target channel. |
| `/listvote` | (Requires Manage Guild) Dashboard for existing vote entries: update channel/URL, change defaults, delete entries with automatic subscriber reassignment. |

All interactive components are ephemeral to avoid cluttering public channels.

## Reminder Lifecycle
1. **Fine-grained scheduler** � each subscription gets a `node-cron` task that fires every minute in its configured timezone.
2. **Daily window guard** � reminders trigger only between `window.start` and `window.end`, supporting overnight windows (e.g., 22:00�06:00).
3. **Per-entry cooldowns** � set `cooldownMinutes` per vote entry (default 120). Timers consider both `lastReminderAt` and `lastVotedAt`.
4. **Delivery fallback** � if channel delivery fails (missing perms, deleted channel), the bot falls back to DMs and logs the issue.
5. **Smart buttons** � `Vote now` opens the URL (direct or signed). `Reset timer` records a vote immediately and restarts the cooldown.
6. **Optional tracking** � with `PUBLIC_BASE_URL`, clicks pass through `/v?t=...`, updating `lastVotedAt` before redirecting to the actual vote page.

## Data Persistence
- `data/config.json` � global configuration (vote entries, timezone, forced mode). Created automatically when missing.
- `data/subscriptions.json` � schema v4 list (one row per subscription). `storage.js` migrates legacy layouts (`subscribers.json`, etc.).
- Files are pretty-printed for easier manual inspection; they are written after every command-driven change.
- Docker uses the `bot_data` volume to keep these files across restarts.

## Docker Deployment
1. Provide a `.env` file (Compose reads from your shell or the file directly).
2. Build and start:
   ```bash
   docker compose up -d --build
   ```
3. Publish commands if needed:
   ```bash
   docker compose run --rm bot node src/deploy-commands.js
   ```
4. Configuration lives in the `bot_data` volume. After editing `.env`, rerun `docker compose up -d` to recreate the container with the new settings.

`PORT` (default 3000) exposes `/health` and `/v`. Configure your reverse proxy accordingly if you want a public domain for tracking.

## HTTP Helper & Vote Tracking
The embedded Express server provides:
- `GET /` � returns `OK`, handy for uptime monitors.
- `GET /health` � returns `{ ok: true }`.
- `GET /v?t=<token>` � validates the HMAC signature, updates `lastVotedAt`, fetches the user display name, appends `?pseudo=<displayName>` to the actual vote URL, and redirects.

Enable this workflow by setting `PUBLIC_BASE_URL` (pointing to the server that exposes the Express app) and `MARK_SECRET`. The `Vote now` button will then hit your domain first, giving you click analytics.

## Troubleshooting
- **Slash commands do not appear** � double-check `CLIENT_ID`, rerun `npm run deploy:commands`. Without `GUILD_ID`, global propagation can take up to 1 hour.
- **Bot online but no reminders** � ensure each vote entry has a valid URL, subscribers completed `/subscribe`, and current time falls inside their configured window.
- **DMs fail** � Discord blocks DMs if the user disabled server messages. Encourage them to pick the channel delivery mode instead.
- **Multiple vote URLs per server** � use `/addvote` to duplicate entries with different cooldowns, then assign subscribers via `/listvote`.
- **Logging** � all major actions (errors, reminders, redirects) log to stdout/stderr. Hook your hosting provider to these logs for easier debugging.

## License
Distributed under the [MIT License](LICENSE). You are free to clone, modify, and deploy as long as the license notice remains intact.

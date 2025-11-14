# ReminderVoteBot

![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?style=flat&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat&logo=discord&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-0db7ed?style=flat&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

???? Looking for French docs? [Cliquez ici](README.fr.md).

ReminderVoteBot is a plug-and-play Discord companion that nudges your players to vote on Top-Serveurs (and friends) without spamming chats. Subscribers pick their server, reminder window, timezone, and delivery mode—100% managed via slash commands.

## ? Highlights
- ?? Per-user reminders with 30-minute windows, per-entry cooldowns, DM or channel delivery, and auto-fallback to DMs.
- ?? Multi-lingual (FR/EN) UI + multi-vote-entry management with `/addvote` & `/listvote`.
- ?? Smart buttons: `Vote now` opens the real URL (or a signed redirect), `Reset timer` restarts the cooldown instantly.
- ?? Lightweight Express server for `/health` and `/v?t=...` redirects so you can track vote clicks.
- ?? Ready-made Docker image `ghcr.io/mrddream/remindervotebot:latest` with persistent volume for `data/`.

## ?? Quickstart (Docker-first)
1. **Prep env vars** – create a `.env` next to `docker-compose.yml`:
   ```env
   DISCORD_TOKEN=xxxxxxxx
   CLIENT_ID=yyyyyyyy
   GUILD_ID=optional_guild_id
   BOT_LANG=en
   DEFAULT_TZ=Europe/Paris
   ```
2. **Launch the public image**:
   ```bash
   docker compose pull
   docker compose up -d
   ```
   The compose file already targets `ghcr.io/mrddream/remindervotebot:latest` and mounts a `bot_data` volume.
3. **Deploy slash commands** (guild = instant, global = up to 1h):
   ```bash
   docker compose run --rm bot node src/deploy-commands.js
   ```
4. Check logs with `docker compose logs -f bot`. Config/state persists inside `bot_data`.

## ????? Prefer local Node?
```bash
git clone https://github.com/<your-org>/ReminderVoteBot.git
cd ReminderVoteBot
npm install
cp .env.example .env  # or create manually
npm run deploy:commands
npm start
```

## ?? Environment Variables
| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | ? | Bot token (Developer Portal > Bot). |
| `CLIENT_ID` | ? | Application/client ID. |
| `GUILD_ID` | ? | Guild ID for fast command deploy (leave empty = global). |
| `DEFAULT_VOTE_URL` | ? | Initial vote URL seeded into config. |
| `DEFAULT_TZ` | ? | Default timezone (e.g., `Europe/Paris`). |
| `BOT_LANG` | ? | `fr` or `en`. |
| `FORCE_DELIVERY_MODE` | ? | Force `dm` or `channel` for new subs. |
| `PUBLIC_BASE_URL` | ? | Public domain for signed redirects. |
| `MARK_SECRET` | ? | HMAC secret used when `PUBLIC_BASE_URL` is set. |
| `PORT` | ? | Express port (default 3000). |

`DEFAULT_*` values only seed `data/config.json` on first launch—you can fine-tune later via `/listvote`.

## ?? Slash Commands Cheat Sheet
| Command | What it does |
| --- | --- |
| `/subscribe` | Guided flow to pick vote entry, window, mode, timezone. |
| `/unsubscribe` | Drop one or all reminders. |
| `/status` | Display + edit current subscriptions. |
| `/addvote` *(Manage Guild)* | Add a vote URL with label, cooldown, optional channel. |
| `/listvote` *(Manage Guild)* | Update URLs/channels, switch defaults, delete entries with safe reassignment. |

Interactions are ephemeral so public channels stay clean.

## ?? Reminder Flow (TL;DR)
1. Minute-level cron per subscription, aligned with its timezone.
2. Fires only inside the configured window (overnight ranges supported).
3. Cooldown respects both `lastReminderAt` and `lastVotedAt`.
4. Channel mode falls back to DM if permissions break.
5. Buttons open the vote link or reset the timer instantly.
6. With `PUBLIC_BASE_URL`, clicks pass through `/v?t=...` before redirecting, so stats stay accurate.

## ?? Data & HTTP endpoints
- `data/config.json` – vote entries, timezone defaults, forced mode.
- `data/subscriptions.json` – schema v4, one record per subscription (legacy data auto-migrated).
- Express exposes:
  - `GET /` ? `OK`
  - `GET /health` ? `{ ok: true }`
  - `GET /v?t=TOKEN` ? validates HMAC, updates `lastVotedAt`, redirects with `?pseudo=<displayName>`

## ?? Troubleshooting
- ?? Slash commands missing? Re-run `npm run deploy:commands` (or Docker equivalent) and wait up to 1h for global deploys.
- ?? DMs blocked? Ask members to switch to channel mode or enable server DMs.
- ?? No reminders? Ensure vote entries have URLs, users finished `/subscribe`, and current time fits their window.
- ??? Channel deleted? `/listvote` lets you assign another channel; the bot falls back to DM meanwhile.
- ?? Need logs? `docker compose logs -f bot` (or stdout when running locally).

## ?? License
Released under the [MIT License](LICENSE). Fork it, tweak it, ship it ?

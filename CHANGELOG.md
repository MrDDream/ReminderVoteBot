# Changelog

## [1.2.0] - 2026-10-27

### ⚠️ Upgrade notes (breaking changes)
- **`GUILD_ID` is now required**: the bot serves a single Discord server. Slash commands are only registered there, and global commands left by older versions are removed.
- **`MARK_SECRET` must be at least 32 characters** when `PUBLIC_BASE_URL` is set (`openssl rand -hex 32`). The bot refuses to start otherwise.
- **The container no longer runs as root.** If your `bot_data` volume comes from an older image, run once: `docker compose run --rm --user root bot chown -R node:node /app/data` (the bot prints this command if needed).
- **Node.js 26** is required (the Docker image is based on `node:26-alpine`).
- Vote links in reminders sent by older versions no longer work; their *I voted* button still does.

### New
- Reminders are embeds naming the voting site, with **Vote now**, **✅ I voted** and **⏰ In 30 min** (snooze) buttons; the message is updated once the vote is recorded.
- `/subscribe`: time window presets or any custom hours (`9h`, `21:30`…), **per-player timezone**, first reminder preview; subscribing twice to the same site is prevented.
- `/status`: one card per subscription with Discord timestamps (last vote, next reminder), edit, delete, and **Resume** for subscriptions paused after failed deliveries.
- `/addvote` takes the cooldown and channel as command options; `/listvote` changes them from menus and shows the subscriber count.
- `{pseudo}` placeholder anywhere in the vote URL.
- Docker image for **amd64 and arm64**, with a health check and graceful shutdown.
- Project website with Discord mockups: https://mrddream.github.io/ReminderVoteBot/

### Fixed
- Scheduling: the first reminder no longer depends on hitting the exact window-start minute, ignored reminders are repeated every cooldown, overnight windows work after midnight.
- Confirming an older `/unsubscribe` message after opening `/status` could delete **all** subscriptions; every button now carries its own target.
- Deleting a voting site moved its subscribers to another site (creating duplicates); its subscriptions are now deleted.
- Corrupted data files were silently replaced by empty ones; writes are now atomic with a `.bak` copy.
- A vote URL longer than Discord's limit, or a malformed `PUBLIC_BASE_URL`, paused every subscriber.
- `/status` could exceed Discord's embed size limit; display names were never refreshed; invalid timezones crashed the reminder loop.

### Security
- Admin commands check the “Manage Server” permission on the bot side, on the configured server only.
- Vote links: no default secret, signed per subscription, valid for 7 days, replays ignored; in channel mode the personal link is only sent privately.
- Non-root container; CI actions pinned to commit SHAs; Dependabot enabled.

### Internal
- Node.js 26, express 5, node-cron 4, dotenv removed (native `.env` loading).
- Subscription saves batched, reminders sent concurrently, dead code removed, ESLint and unit tests in CI.

## [1.1.1] - 2025-11-17
See the [1.1.1 release](https://github.com/MrDDream/ReminderVoteBot/releases/tag/1.1.1).

## [1.0.0] - 2025-11-14
First release.

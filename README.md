# ReminderVoteBot
This documentation is available in [French](README.fr.md) and in [English](README.md)

## Overview
A Discord bot that sends automated vote reminders to subscribed users via direct messages or channel pings. The bot supports multiple vote servers, customizable time windows, timezone-aware scheduling, and configurable cooldown periods.

## Features

- 🔔 **Automated Vote Reminders**: Sends reminders via DM or channel pings based on user preferences
- ⏰ **Time Window Support**: Configure specific hours when reminders should be sent
- 🌍 **Timezone Aware**: Supports different timezones for accurate scheduling
- 🎯 **Multiple Vote Servers**: Manage multiple vote URLs with different cooldown periods
- 🔄 **Cooldown Management**: Configurable cooldown periods (1h, 2h, 3h, 4h, 12h, 24h)
- 🌐 **Web Redirect**: Optional web interface for secure vote tracking
- 🌍 **Multilingual**: Supports English and French
- 📊 **Status Management**: View and manage your subscriptions easily

## Prerequisites

- Node.js 20 or higher
- A Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- (Optional) Docker and Docker Compose for containerized deployment

## Installation

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/mrddream/ReminderVoteBot.git
cd ReminderVoteBot
```

2. Create a `.env` file in the project root:
```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id  # Optional, for guild-specific commands
DEFAULT_TZ=Europe/Paris  # Default timezone
BOT_LANG=en  # or 'fr' for French
PUBLIC_BASE_URL=https://your-domain.com  # Optional, for vote redirect
MARK_SECRET=your_secret_key  # Optional, for secure vote tokens
PORT=3000  # Optional, default is 3000
```

3. Start with Docker Compose:
```bash
docker-compose up -d
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/mrddream/ReminderVoteBot.git
cd ReminderVoteBot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (see configuration section above)

4. Deploy Discord commands:
```bash
npm run deploy:commands
```

5. Start the bot:
```bash
npm start
```

## Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DISCORD_TOKEN` | Yes | Your Discord bot token | - |
| `CLIENT_ID` | Yes | Your Discord application client ID | - |
| `GUILD_ID` | No | Guild ID for guild-specific commands (faster deployment) | - |
| `DEFAULT_TZ` | No | Default timezone for reminders | `Europe/Paris` |
| `BOT_LANG` | No | Bot language (`en` or `fr`) | `fr` |
| `PUBLIC_BASE_URL` | No | Base URL for vote redirect service | - |
| `MARK_SECRET` | No | Secret key for vote token signing | - |
| `PORT` | No | HTTP server port | `3000` |

### Data Storage

The bot stores data in the `data/` directory:
- `data/config.json`: Bot configuration and vote URLs
- `data/subscriptions.json`: User subscriptions

Files are written atomically and the previous version is kept as `*.json.bak`. If a file is corrupted, the bot restores it from the `.bak` copy; if that is not possible, it refuses to start instead of overwriting your data.

**Important**: Make sure to backup the `data/` directory regularly!

## Usage

### User Commands

#### `/subscribe`
Subscribe to vote reminders. You can configure:
- **Server**: Choose which vote server to receive reminders for (servers you are already subscribed to are marked and cannot be picked twice)
- **Time Window**: Pick a preset (all day, daytime, morning, afternoon, evening) or **Custom…** to type any start and end time (e.g. `9h`, `21:30`)
- **Mode**: Direct message, or a ping in the server's channel (only offered when the admin configured one)
- **Timezone**: Pick your timezone (shown with its UTC offset and current local time)

The form shows when the first reminder will be sent.

#### `/unsubscribe`
Unsubscribe from vote reminders. You can remove a specific subscription or all subscriptions.

#### `/status`
View your current subscriptions, including:
- Server name
- Time window and timezone
- Delivery mode
- Cooldown period
- Last recorded vote and next reminder (as Discord timestamps, shown in your own timezone)

You can also edit (time window, mode, timezone) or delete subscriptions from this interface. If a subscription was paused because reminders could not be delivered, a **Resume** button appears.

### Reminder messages
Each reminder names the vote server and has three buttons:
- **Vote now**: opens the vote page (and records the vote automatically when `PUBLIC_BASE_URL` is set)
- **✅ I voted**: records the vote and restarts the cooldown; the message is updated to show it
- **⏰ In 30 min**: snoozes the reminder for 30 minutes

### Administrator Commands

#### `/addvote [cooldown] [channel]`
Add a new vote URL. Requires "Manage Server" permission.
- **cooldown** option (optional): 1h, 2h, 3h, 4h, 12h or 24h (default 2h)
- **channel** option (optional): channel used for the ping mode

A form then asks for:
- **Name**: Display name for the vote server
- **URL**: The vote URL. Put `{pseudo}` where the user's display name must go (e.g. `https://site/vote/{pseudo}`); without it, `?pseudo=<name>` is appended to the URL

#### `/listvote`
List and manage existing vote URLs. You can:
- View all configured vote servers and their subscriber count
- Change the cooldown and the ping channel directly from menus
- Edit the name and URL
- Delete vote servers

## How It Works

1. **Subscription**: Users subscribe using `/subscribe` and configure their preferences
2. **Scheduling**: Every minute, the bot checks every subscription to see if a reminder is due
3. **Time Window**: Reminders are only sent during the configured time window (in the user's timezone). If one becomes due outside the window, it is sent when the window opens
4. **Cooldown**: After a reminder is sent or a vote is marked, the bot waits for the cooldown period before sending another reminder. An ignored reminder is therefore repeated every cooldown until the user votes
5. **Delivery**: Reminders are sent via DM or as a channel ping, depending on user preference (falls back to DM if the channel fails). After 3 consecutive failed deliveries, the subscription is paused and `/status` explains how to resume it
6. **Vote Tracking**: Votes are recorded with the **I voted** button, or automatically through the **Vote now** link if `PUBLIC_BASE_URL` is configured

## Docker

### Development

Use `docker-compose-dev.yml` to build the image from the local sources.

Run the unit tests with `npm test`.

### Production

The `docker-compose.yml` file is configured for production use with:
- Automatic command deployment on startup
- Volume persistence for data
- Health check endpoint at `/health`
- Port mapping for the HTTP server

## Project Structure

```
ReminderVoteBot/
├── src/
│   ├── index.js          # Main bot logic
│   ├── config.js         # Configuration management
│   ├── storage.js        # Subscription storage
│   ├── schedule.js       # Reminder scheduling rules (time windows, cooldown, snooze)
│   ├── jsonFile.js       # Atomic JSON writes with .bak backup
│   └── deploy-commands.js # Discord command deployment
├── data/                 # Data directory (created at runtime)
│   ├── config.json       # Bot configuration
│   └── subscriptions.json # User subscriptions
├── test/                 # Unit tests (npm test)
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Production Docker Compose
├── docker-compose-dev.yml # Development Docker Compose
├── package.json          # Node.js dependencies
└── README.md            # This file
```

## Features in Detail

### Time Windows
- Users pick a preset or type any start and end time (`HH:MM`, `9h`, `21h30`…)
- Supports overnight windows (e.g., 22:00-06:00)
- Timezone-aware: each subscription has its own timezone (default: `DEFAULT_TZ`)

### Cooldown System
- Each vote server can have its own cooldown period
- Default cooldown is 2 hours (120 minutes)
- Supported values: 60, 120, 180, 240, 720, 1440 minutes
- Timer resets when the user clicks "I voted" (or "Vote now" when `PUBLIC_BASE_URL` is set)

### Multiple Vote Servers
- Administrators can add multiple vote servers
- Each server has its own URL, cooldown, and optional ping channel
- Users can subscribe to different servers with different configurations

### Vote Redirect Service
If `PUBLIC_BASE_URL` is configured:
- The bot provides a secure redirect service at `/v?t=<token>`
- Tokens are signed with HMAC-SHA256 and identify the subscription, so the vote is recorded on the right server
- Automatically tracks when users vote and updates the reminder message
- Falls back to direct vote URL if not configured

## Troubleshooting

### Bot not responding
- Check that the bot token is correct
- Verify the bot has necessary permissions (Send Messages, Direct Messages)
- Check bot logs for errors

### Reminders not being sent
- Verify the time window is correctly configured
- Check that the cooldown period has elapsed (`/status` shows the next reminder)
- Ensure the bot can send DMs or access the configured channel; a subscription paused after failed deliveries can be resumed from `/status`
- Check timezone settings

### Commands not appearing
- Run `npm run deploy:commands` to deploy commands
- Wait up to 1 hour for global commands to propagate
- Use `GUILD_ID` for instant guild-specific command deployment

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

---

Made with ❤️ by MrDDream


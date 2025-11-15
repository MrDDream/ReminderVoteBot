# ReminderVoteBot

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
| `DEFAULT_VOTE_URL` | No | Legacy: default vote URL (deprecated, use `/addvote`) | - |

### Data Storage

The bot stores data in the `data/` directory:
- `data/config.json`: Bot configuration and vote URLs
- `data/subscriptions.json`: User subscriptions

**Important**: Make sure to backup the `data/` directory regularly!

## Usage

### User Commands

#### `/subscribe`
Subscribe to vote reminders. You can configure:
- **Server**: Choose which vote server to receive reminders for
- **Time Window**: Set start and end times for reminders (in 30-minute increments)
- **Mode**: Choose between DM (direct message) or Channel ping

#### `/unsubscribe`
Unsubscribe from vote reminders. You can remove a specific subscription or all subscriptions.

#### `/status`
View your current subscriptions, including:
- Server name and ID
- Time window
- Timezone
- Delivery mode
- Cooldown period
- Next reminder timer

You can also edit or delete subscriptions from this interface.

### Administrator Commands

#### `/addvote`
Add a new vote URL. Requires "Manage Server" permission. You need to provide:
- **Name**: Display name for the vote server
- **URL**: The vote URL (can include `{pseudo}` placeholder)
- **Cooldown**: Cooldown period in minutes (60, 120, 180, 240, 720, or 1440)
- **Channel ID** (optional): Default channel for channel ping mode

#### `/listvote`
List and manage existing vote URLs. You can:
- View all configured vote servers
- Edit vote server details
- Delete vote servers

## How It Works

1. **Subscription**: Users subscribe using `/subscribe` and configure their preferences
2. **Scheduling**: The bot uses cron jobs to check every minute if reminders should be sent
3. **Time Window**: Reminders are only sent during the configured time window (in the user's timezone)
4. **Cooldown**: After a reminder is sent or a vote is marked, the bot waits for the cooldown period before sending another reminder
5. **Delivery**: Reminders are sent via DM or as a channel ping, depending on user preference
6. **Vote Tracking**: When users click the vote button, the bot can track votes (if `PUBLIC_BASE_URL` is configured)

## Docker

### Development

Use `docker-compose-dev.yml` for development with hot-reload (if configured).

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
│   └── deploy-commands.js # Discord command deployment
├── data/                 # Data directory (created at runtime)
│   ├── config.json       # Bot configuration
│   └── subscriptions.json # User subscriptions
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Production Docker Compose
├── docker-compose-dev.yml # Development Docker Compose
├── package.json          # Node.js dependencies
└── README.md            # This file
```

## Features in Detail

### Time Windows
- Users can set a start and end time for reminders
- Times must be in 30-minute increments (e.g., 08:00, 08:30, 09:00)
- Supports overnight windows (e.g., 22:00-06:00)
- Timezone-aware using the configured timezone

### Cooldown System
- Each vote server can have its own cooldown period
- Default cooldown is 2 hours (120 minutes)
- Supported values: 60, 120, 180, 240, 720, 1440 minutes
- Timer resets when user clicks "Vote now" or uses the reset button

### Multiple Vote Servers
- Administrators can add multiple vote servers
- Each server has its own URL, cooldown, and optional default channel
- Users can subscribe to different servers with different configurations

### Vote Redirect Service
If `PUBLIC_BASE_URL` is configured:
- The bot provides a secure redirect service at `/v?t=<token>`
- Tokens are signed with HMAC-SHA256
- Automatically tracks when users vote
- Falls back to direct vote URL if not configured

## Troubleshooting

### Bot not responding
- Check that the bot token is correct
- Verify the bot has necessary permissions (Send Messages, Direct Messages)
- Check bot logs for errors

### Reminders not being sent
- Verify the time window is correctly configured
- Check that the cooldown period has elapsed
- Ensure the bot can send DMs or access the configured channel
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


# Railway Deployment Guide

This guide will help you deploy the Discord-IRC bridge on Railway.

## Quick Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/discord-irc-bridge)

## Manual Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section
4. Create a bot and copy the token

### 2. Deploy to Railway

1. Fork this repository
2. Connect your GitHub account to Railway
3. Create a new project from your forked repository
4. Set the following environment variables:

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your Discord bot token | `YOUR_BOT_TOKEN_HERE` |
| `IRC_NICKNAME` | IRC nickname for the bot | `discord-bridge` |
| `IRC_SERVER` | IRC server to connect to | `irc.libera.chat` |
| `CHANNEL_MAPPING` | JSON mapping Discord to IRC channels | `{"#general": "#random"}` |

### Optional Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `PORT` | Health check server port | `3000` | `3000` |
| `IRC_OPTIONS` | IRC connection options | `{}` | `{"port": 6697, "secure": true}` |
| `COMMAND_CHARACTERS` | Command prefix characters | `[]` | `["!", "."]` |
| `PARALLEL_PING_FIX` | Prevent double pings | `false` | `true` |
| `IRC_NICK_COLOR` | Enable IRC nick colors | `true` | `false` |
| `IRC_STATUS_NOTICES` | Show join/part notifications | `false` | `true` |
| `IGNORE_USERS` | Users to ignore | `{}` | `{"irc": ["spammer"]}` |
| `WEBHOOKS` | Channel webhooks | `{}` | `{"#general": "webhook_url"}` |
| `AUTO_SEND_COMMANDS` | Commands to send on connect | `[]` | `[["PRIVMSG", "NickServ", "IDENTIFY pass"]]` |

### 3. Invite Bot to Discord Server

1. Go to Discord Developer Portal > Your App > OAuth2 > URL Generator
2. Select "Bot" scope
3. Select permissions: "Send Messages", "Read Message History", "Manage Webhooks"
4. Use the generated URL to invite the bot to your server

### 4. Configure IRC Channel

Make sure your bot can join the IRC channel. Some channels may require:
- Channel registration
- Voice/operator privileges
- Channel key/password

## Health Check

The deployment includes a health check endpoint at `/health` that Railway uses to monitor the service.

## Monitoring

You can monitor your deployment in the Railway dashboard:
- View logs for debugging
- Monitor CPU and memory usage
- Check deployment status

## Troubleshooting

### Bot not connecting to IRC
- Check IRC server address and port
- Verify IRC nickname is available
- Check if channel requires registration

### Bot not responding in Discord
- Verify Discord token is correct
- Check bot permissions in Discord server
- Ensure bot is invited to the server

### Environment variable format errors
- JSON variables must be valid JSON strings
- Boolean variables should be "true" or "false" strings
- Arrays must be valid JSON arrays

## Logs

View logs in Railway dashboard to debug issues:
```
npm run start:server
```

The health endpoint will show:
- Service status
- Timestamp
- Service name
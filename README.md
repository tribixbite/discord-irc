# 🌉 Discord-IRC Bridge

<div align="center">

[![Build Status](https://github.com/discord-irc/discord-irc/workflows/CI/badge.svg)](https://github.com/discord-irc/discord-irc/actions)
[![npm version](https://badge.fury.io/js/discord-irc-bridge.svg)](https://www.npmjs.com/package/discord-irc-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Discord](https://img.shields.io/discord/123456789012345678.svg?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/your-server)

**A powerful, feature-rich bridge connecting Discord and IRC with enterprise-grade reliability**

*Seamlessly synchronize messages, manage channels, and maintain full IRC feature parity within Discord*

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [⚙️ Configuration](#️-configuration) • [🎯 Features](#-features) • [🛠️ Contributing](#️-contributing)

</div>

---

## ✨ Features at a Glance

### 🔗 **Core Bridging**
- **Bidirectional messaging** between Discord and IRC channels
- **Real-time synchronization** with message edit/delete support
- **Rich media handling** with S3-compatible attachment storage
- **Webhook integration** for enhanced Discord formatting
- **Private message bridging** with threaded conversations

### 🎛️ **IRC Feature Parity**
- **Complete user tracking** with IP addresses and connection details
- **Channel discovery** with powerful search and filtering
- **Dynamic channel management** - join/leave channels on demand
- **Full moderation suite** - kick, ban, topic management, channel modes
- **Raw IRC command execution** for advanced administration
- **WHO/WHOIS queries** with pattern-based network search
- **Ban/quiet/exception list viewing**

### 🛡️ **Enterprise Features**
- **Advanced rate limiting** with spam detection and auto-moderation
- **Comprehensive monitoring** with Prometheus metrics
- **Graceful error recovery** with automatic reconnection
- **Persistent state management** with configurable backends
- **Status notifications** with dedicated channels
- **Mention detection** with anti-self-ping protection

### 🎨 **User Experience**
- **Rich Discord slash commands** for all IRC operations
- **Interactive embeds** with formatted channel and user information
- **Admin-only controls** with granular permission management
- **Real-time feedback** with progress indicators and error handling
- **Comprehensive logging** with configurable levels

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ 
- **Discord Bot Token** - [Get one here](https://discord.com/developers/applications)
- **IRC Server Access** - Any IRC network (Libera.Chat, OFTC, etc.)

### Installation

```bash
# Install via npm
npm install -g discord-irc-bridge

# Or clone and build from source
git clone https://github.com/discord-irc/discord-irc.git
cd discord-irc
npm install
npm run build
```

### Basic Setup

1. **Create a bot configuration file:**

```json
{
  "nickname": "DiscordBot",
  "server": "irc.libera.chat",
  "discordToken": "YOUR_DISCORD_BOT_TOKEN",
  "channelMapping": {
    "DISCORD_CHANNEL_ID": "#irc-channel"
  }
}
```

2. **Start the bridge:**

```bash
# Using global installation
discord-irc-bridge --config config.json

# Or from source
npm start -- --config config.json
```

3. **Verify connection:**
   - Check Discord for successful bot login
   - Verify IRC connection in server logs
   - Test message synchronization

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/discord-irc-bridge)

---

## 📖 Documentation

### 🎯 Core Concepts

#### Channel Mapping
The bridge connects Discord channels to IRC channels through a flexible mapping system:

```json
{
  "channelMapping": {
    "123456789012345678": "#general",     // Discord channel ID to IRC channel
    "#announcements": "#announcements",    // Discord channel name (with #)
    "987654321098765432": "#dev +secret"  // IRC channel with key
  }
}
```

#### Message Synchronization
- **Discord → IRC**: Messages are formatted for IRC compatibility
- **IRC → Discord**: Messages support rich formatting and mentions
- **Bidirectional edits**: Edit messages in either platform
- **Deletion sync**: Delete messages with configurable time windows

#### User Management
The bridge maintains comprehensive user information:
- Real-time IRC user tracking with WHOIS data
- Channel membership and operator status
- Connection details including IP addresses
- Away status and idle time monitoring

---

## ⚙️ Configuration

### 📋 Complete Configuration Reference

<details>
<summary><strong>📂 Core Settings</strong></summary>

```json
{
  "nickname": "DiscordBot",
  "server": "irc.libera.chat",
  "port": 6697,
  "secure": true,
  "password": "optional_server_password",
  "discordToken": "YOUR_DISCORD_BOT_TOKEN",
  "channelMapping": {
    "DISCORD_CHANNEL_ID": "#irc-channel"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `nickname` | string | IRC nickname for the bot |
| `server` | string | IRC server hostname |
| `port` | number | IRC server port (default: 6697 for SSL) |
| `secure` | boolean | Use SSL/TLS connection |
| `discordToken` | string | Discord bot token |
| `channelMapping` | object | Discord ↔ IRC channel mappings |

</details>

<details>
<summary><strong>🎛️ Advanced Features</strong></summary>

```json
{
  "privateMessages": {
    "enabled": true,
    "channelId": "PM_CHANNEL_ID",
    "threadPrefix": "PM: ",
    "autoArchive": 60
  },
  "webhooks": {
    "DISCORD_CHANNEL_ID": "https://discord.com/api/webhooks/..."
  },
  "rateLimiting": {
    "enabled": true,
    "maxMessages": 5,
    "windowMs": 60000,
    "blockDuration": 300000
  },
  "statusNotifications": {
    "enabled": true,
    "joinLeaveChannelId": "CHANNEL_ID",
    "includeJoins": true,
    "includeLeaves": true
  }
}
```

</details>

<details>
<summary><strong>🏢 Enterprise Settings</strong></summary>

```json
{
  "persistence": {
    "type": "redis",
    "config": {
      "host": "localhost",
      "port": 6379,
      "database": 0
    }
  },
  "s3": {
    "enabled": true,
    "endpoint": "https://s3.amazonaws.com",
    "bucket": "discord-attachments",
    "accessKeyId": "ACCESS_KEY",
    "secretAccessKey": "SECRET_KEY"
  },
  "metrics": {
    "enabled": true,
    "port": 3001,
    "path": "/metrics"
  },
  "recovery": {
    "maxRetries": 3,
    "backoffMs": 5000,
    "enableAutoRecover": true
  }
}
```

</details>

### 🌍 Environment Variables

```bash
# Discord Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id

# IRC Configuration  
IRC_SERVER=irc.libera.chat
IRC_NICKNAME=DiscordBot
IRC_PORT=6697
IRC_SECURE=true

# Database & Storage
REDIS_URL=redis://localhost:6379
S3_BUCKET=discord-attachments
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=3001
LOG_LEVEL=info
```

---

## 🎮 Discord Commands

### 📊 **Administrative Commands**

#### `/irc-status`
Display comprehensive bridge status and statistics
- IRC server connection details
- Tracked users and channels
- Message synchronization stats
- Rate limiting information
- System health metrics

#### `/irc-users [subcommand]`
Manage and view IRC user information
- `lookup <nick>` - Get detailed user information with WHOIS data
- `search` - Find users by hostname, realname, channel, etc.
- `stats` - Network-wide user statistics
- `refresh <nick>` - Force refresh user information

#### `/irc-channels [subcommand]`
Discover and manage IRC channels
- `list [pattern] [min_users]` - Search available channels with filtering
- `join <channel> [key]` - Join IRC channels dynamically (session only)
- `part <channel> [message]` - Leave IRC channels gracefully
- `info <channel>` - Channel details and comprehensive user lists

### 🔨 **Moderation Commands**

#### `/irc-command [subcommand]`
Execute IRC commands with safety controls
- `send <command> [args]` - Send raw IRC commands (admin only)
- `moderation` - Channel moderation tools (kick, ban, topic, modes)

#### `/irc-who <pattern>`
Advanced user search across the IRC network
- Pattern-based searching with wildcard support
- Real-time WHO query execution with timeout handling
- Comprehensive user information display with connection details

#### `/irc-lists [subcommand]`
View channel access control lists
- `bans <channel>` - View ban list for channel
- `quiets <channel>` - View quiet list for channel
- `exceptions <channel>` - View ban exception list

### 🔧 **System Management**

#### `/irc-recovery`
Monitor and control error recovery systems
- `status` - View recovery manager health and statistics
- `health` - Detailed health check results for all components
- `trigger` - Manually trigger recovery process (emergency use)

---

## 🛠️ Development & Deployment

### 🔧 Development Setup

```bash
# Clone the repository
git clone https://github.com/discord-irc/discord-irc.git
cd discord-irc

# Install dependencies
npm install

# Set up development environment
cp .env.example .env
# Edit .env with your configuration

# Start in development mode
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run coverage
```

### 🏗️ Building from Source

```bash
# Build TypeScript
npm run build

# Lint code
npm run lint

# Format code
npm run format

# Type checking
npm run typecheck
```

### 🐳 Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY config/ ./config/

EXPOSE 3000
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  discord-irc-bridge:
    build: .
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - IRC_SERVER=${IRC_SERVER}
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./config:/app/config
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### ☁️ Cloud Deployment

<details>
<summary><strong>🚀 Deploy to Railway</strong></summary>

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template/discord-irc-bridge)

1. Click the deploy button above
2. Configure environment variables
3. Connect your GitHub repository
4. Deploy automatically

</details>

<details>
<summary><strong>🌊 Deploy to Heroku</strong></summary>

```bash
# Install Heroku CLI and login
heroku login

# Create application
heroku create your-app-name

# Set configuration
heroku config:set DISCORD_TOKEN=your_token
heroku config:set IRC_SERVER=irc.libera.chat

# Deploy
git push heroku main
```

</details>

---

## 🔍 Troubleshooting

### Common Issues

<details>
<summary><strong>🚫 Bot not connecting to Discord</strong></summary>

**Symptoms:** Bot appears offline, no response to commands

**Solutions:**
1. Verify Discord token is correct and not expired
2. Check bot permissions in Discord server
3. Ensure bot has necessary intents enabled
4. Review Discord application settings

```bash
# Test token validity
curl -H "Authorization: Bot YOUR_TOKEN" \
     https://discord.com/api/users/@me
```

</details>

<details>
<summary><strong>📡 IRC connection failures</strong></summary>

**Symptoms:** IRC connection timeouts, authentication errors

**Solutions:**
1. Verify IRC server hostname and port
2. Check if server requires SASL authentication
3. Ensure nickname is not already in use
4. Review IRC server connection logs

```json
{
  "server": "irc.libera.chat",
  "port": 6697,
  "secure": true,
  "sasl": {
    "username": "your_username",
    "password": "your_password"
  }
}
```

</details>

<details>
<summary><strong>💬 Messages not syncing</strong></summary>

**Symptoms:** Messages appear in one platform but not the other

**Solutions:**
1. Verify channel mapping configuration
2. Check bot permissions in both Discord and IRC
3. Review rate limiting settings
4. Examine bridge logs for errors

```bash
# Enable debug logging
LOG_LEVEL=debug npm start
```

</details>

### Debug Mode

Enable comprehensive logging for troubleshooting:

```json
{
  "logLevel": "debug",
  "debugChannels": ["#test-channel"],
  "enableRawLogging": true
}
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### 🛡️ Security

For security concerns, please email security@discord-irc.com instead of using GitHub issues.

### 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### 🙏 Acknowledgments

- Built with [discord.js](https://discord.js.org/) and [irc-upd](https://github.com/Throne3d/node-irc)
- Inspired by the IRC and Discord communities
- Special thanks to all contributors and maintainers

---

<div align="center">

**Made with ❤️ by the Discord-IRC Bridge team**

[⭐ Star us on GitHub](https://github.com/discord-irc/discord-irc) • [🐛 Report Issues](https://github.com/discord-irc/discord-irc/issues) • [💬 Join our Discord](https://discord.gg/your-server)

</div>
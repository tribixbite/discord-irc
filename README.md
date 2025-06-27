> Connects [Discord](https://discord.com/) and [IRC](https://www.ietf.org/rfc/rfc1459.txt) channels by sending messages back and forth.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/discord-irc-bridge)

## Installation and usage
**Note**: discord-irc requires Node.js version 12 or newer, as it depends on [discord.js](https://github.com/hydrabolt/discord.js).
Future versions may require newer Node.js versions, though we should support active releases.

Before you can run discord-irc you need to create a configuration file by
following the instructions below.
After you've done that you can replace `/path/to/config.json` in the commands
below with the path to your newly created configuration file - or just `config.json` if it's
in the same directory as the one you're starting the bot from.

When you've done that you can install and start the bot either through npm:

```bash
$ npm install -g discord-irc
$ discord-irc --config /path/to/config.json
```

or by cloning the repository:

```bash
In the repository folder:
$ npm install
$ npm run build
$ npm start -- --config /path/to/config.json # Note the extra double dash
```

## Deploy on Railway

You can easily deploy this Discord-IRC bridge on [Railway](https://railway.app) using environment variables:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/discord-irc-bridge)

### Railway Environment Variables

Instead of using a configuration file, you can configure the bot using environment variables:

**Required Variables:**
- `DISCORD_TOKEN` - Your Discord bot token
- `IRC_NICKNAME` - IRC nickname for the bot
- `IRC_SERVER` - IRC server to connect to (e.g., `irc.libera.chat`)
- `CHANNEL_MAPPING` - JSON object mapping Discord channels to IRC channels (e.g., `{"#discord": "#irc"}`)

**Optional Variables:**
- `PORT` - Port for the health check server (default: 3000)
- `IRC_OPTIONS` - JSON object with IRC connection options (e.g., `{"port": 6697, "secure": true}`)
- `COMMAND_CHARACTERS` - JSON array of command prefixes (e.g., `["!", "."]`)
- `PARALLEL_PING_FIX` - Set to `true` to prevent double pings (default: false)
- `IRC_NICK_COLOR` - Set to `false` to disable IRC nick colors (default: true)
- `IRC_STATUS_NOTICES` - Set to `true` to enable join/part notifications (default: false)
- `IGNORE_USERS` - JSON object to ignore specific users (e.g., `{"irc": ["nick1"], "discord": ["nick2"]}`)
- `WEBHOOKS` - JSON object mapping channels to webhook URLs
- `AUTO_SEND_COMMANDS` - JSON array of commands to send on connect
- `PM_CHANNEL_ID` - Discord channel ID for private message threads (e.g., `123456789` or `#pm-channel`)
- `PM_THREAD_PREFIX` - Prefix for PM thread names (default: `"PM: "`)
- `PM_AUTO_ARCHIVE` - Auto-archive threads after N minutes of inactivity (default: `60`)

The Railway deployment includes a health check endpoint at `/health` for monitoring.

## Configuration
First you need to create a Discord bot user, which you can do by following the instructions [here](https://github.com/reactiflux/discord-irc/wiki/Creating-a-discord-bot-&-getting-a-token).

### Example configuration
```js
[
  // Bot 1 (minimal configuration):
  {
    "nickname": "test2",
    "server": "irc.testbot.org",
    "discordToken": "botwantsin123",
    "channelMapping": {
      "#other-discord": "#new-irc-channel"
    }
  },

  // Bot 2 (advanced options):
  {
    "nickname": "test",
    "server": "irc.bottest.org",
    "discordToken": "botwantsin123",
    "autoSendCommands": [ // Commands that will be sent on connect
      ["PRIVMSG", "NickServ", "IDENTIFY password"],
      ["MODE", "test", "+x"],
      ["AUTH", "test", "password"]
    ],
    "channelMapping": { // Maps each Discord-channel to an IRC-channel, used to direct messages to the correct place
      "#discord": "#irc channel-password", // Add channel keys after the channel name
      "1234567890": "#channel" // Use a discord channel ID instead of its name (so you can rename it or to disambiguate)
    },
    "ircOptions": { // Optional node-irc options
      "floodProtection": false, // On by default
      "floodProtectionDelay": 1000, // 500 by default
      "port": "6697", // 6697 by default
      "secure": true, // enable SSL, false by default
      "sasl": true, // false by default
      "username": "test", // nodeirc by default
      "password": "p455w0rd" // empty by default
    },
    "format": { // Optional custom formatting options
      // Patterns, represented by {$patternName}, are replaced when sending messages
      "commandPrelude": "Command sent by {$nickname}", // Message sent before a command
      "ircText": "<{$displayUsername}> {$text}", // When sending a message to IRC
      "urlAttachment": "<{$displayUsername}> {$attachmentURL}", // When sending a Discord attachment to IRC
      "discord": "**<{$author}>** {$withMentions}", // When sending a message to Discord
      // Other patterns that can be used:
      // {$discordChannel} (e.g. #general)
      // {$ircChannel} (e.g. #irc)
      "webhookAvatarURL": "https://robohash.org/{$nickname}" // Default avatar to use for webhook messages
    },
    "ircNickColor": false, // Gives usernames a color in IRC for better readability (on by default)
    "ircNickColors": ['light_blue', 'dark_blue', 'light_red', 'dark_red', 'light_green', 'dark_green', 'magenta', 'light_magenta', 'orange', 'yellow', 'cyan', 'light_cyan'], // Which irc-upd colors to use
    "parallelPingFix": true, // Prevents users of both IRC and Discord from being mentioned in IRC when they speak in Discord (off by default)
    // Makes the bot hide the username prefix for messages that start
    // with one of these characters (commands):
    "commandCharacters": ["!", "."],
    "ircStatusNotices": true, // Enables notifications in Discord when people join/part in the relevant IRC channel
    "ignoreUsers": {
      "irc": ["irc_nick1", "irc_nick2"], // Ignore specified IRC nicks and do not send their messages to Discord.
      "discord": ["discord_nick1", "discord_nick2"], // Ignore specified Discord nicks and do not send their messages to IRC.
      "discordIds": ["198528216523210752"] // Ignore specified Discord ids and do not send their messages to IRC.
    },
    // List of webhooks per channel
    "webhooks": {
      "#discord": "https://discord.com/api/webhooks/id/token"
    },
    // Private message configuration (optional)
    "privateMessages": {
      "channelId": "#private-messages",  // Discord channel for PM threads
      "threadPrefix": "PM: ",            // Prefix for thread names
      "autoArchive": 60                  // Auto-archive after N minutes
    }
  }
]
```

The `ircOptions` object is passed directly to irc-upd ([available options](https://node-irc-upd.readthedocs.io/en/latest/API.html#irc.Client)).

To retrieve a discord channel ID, write `\#channel` on the relevant server – it should produce something of the form `<#1234567890>`, which you can then use in the `channelMapping` config.

### Webhooks
Webhooks lets you override nicknames and avatars, so messages coming from IRC
can appear as regular Discord messages:

![discord-webhook](http://i.imgur.com/lNeJIUI.jpg)

To enable webhooks, follow part 1 of [this
guide](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)
to create and retrieve a webhook URL for a specific channel, then enable it in
discord-irc's config as follows:

```json
  "webhooks": {
    "#discord-channel": "https://discord.com/api/webhooks/id/token"
  }
```

### Private Messages

The bot supports private message functionality that allows Discord users and IRC users to send direct messages to each other through Discord threads.

When an IRC user sends a private message to the bot, it automatically creates a Discord thread in the designated PM channel. Discord users can reply in that thread, and their messages will be sent as private messages to the IRC user.

![pm-thread-example](https://via.placeholder.com/600x300/7289da/ffffff?text=PM+Thread+Example)

**Features:**
- 🧵 **Thread-based conversations** - Each IRC user gets their own thread
- 🔄 **Bidirectional messaging** - Send and receive messages in both directions  
- 📝 **Thread persistence** - Conversations are preserved and auto-archived when inactive
- 🏷️ **Nick change handling** - Threads update when IRC users change nicknames
- 🔗 **Attachment support** - Discord attachments are sent as URLs to IRC users

**Configuration:**

```json
{
  "privateMessages": {
    "channelId": "#private-messages",    // Discord channel for PM threads
    "threadPrefix": "PM: ",              // Prefix for thread names  
    "autoArchive": 60                    // Auto-archive after N minutes of inactivity
  }
}
```

**Setup:**
1. Create a dedicated Discord channel for private messages (e.g., `#private-messages`)
2. Add the channel ID or name to your bot configuration
3. Ensure the bot has permissions to create and manage threads in that channel
4. IRC users can now send `/msg <botname> <message>` to start conversations
5. Discord users can reply in the automatically created threads

**Thread Management:**
- Threads are named `"PM: <ircnick>"` (customizable with `threadPrefix`)
- Threads auto-archive after the specified time period (default: 60 minutes)
- When archived threads receive new messages, they are automatically unarchived
- If an IRC user changes their nickname, the thread name updates accordingly

**Permissions Required:**
- `Send Messages` in the PM channel
- `Create Public Threads` in the PM channel  
- `Send Messages in Threads`
- `Manage Threads` (for auto-unarchiving)

### Discord Slash Commands

The bot provides Discord slash commands for administration and monitoring. All commands require Administrator permissions.

**Available Commands:**

#### `/irc-status`
Show comprehensive IRC bridge status and statistics
- IRC server and bot nickname
- Number of mapped channels
- Tracked IRC users count
- Active PM threads
- Bot uptime

#### `/irc-users [channel]`
List users in IRC channels
- Without `channel`: Shows all channels and user counts
- With `channel`: Shows detailed user list for specific channel
- Supports channel names with or without `#` prefix

#### `/irc-pm <subcommand>`
Manage IRC private message threads
- `list` - List all active PM threads with Discord links
- `cleanup` - Clean up inactive PM threads (removes threads older than 7 days)
- `close <nickname>` - Close and archive a specific PM thread

#### `/irc-reconnect`
Force IRC client to reconnect
- Useful for connection issues or manual restarts
- Gracefully disconnects and reconnects after 2 seconds

**Setup:**
1. Ensure the bot has `Administrator` permissions in your Discord server
2. Commands are automatically registered when the bot starts
3. All commands are ephemeral (only visible to the user who ran them)
4. Command responses include rich embeds with relevant information

**Security:**
- All commands require Discord Administrator permissions
- Double permission check: Discord permissions + internal admin validation
- Commands are ephemeral to prevent information leakage
- No sensitive data is exposed in command responses

### Message Edit/Delete Synchronization

The bot synchronizes Discord message edits and deletions to IRC, providing transparency when messages are modified or removed after being sent.

**Features:**
- 🔄 **Edit Notifications** - When Discord messages are edited, IRC shows both old and new content
- 🗑️ **Delete Notifications** - When Discord messages are deleted, IRC shows what was removed
- ⏰ **Time Window** - Only recent messages (5 minutes by default) trigger notifications
- 📊 **Bulk Delete Handling** - Discord purge operations show summary notifications
- 💾 **Persistent Tracking** - Message history survives bot restarts
- 🧹 **Automatic Cleanup** - Old message records are automatically removed

**How it works:**
```
Discord: User posts "Hello wrold"
IRC:     <username> Hello wrold

Discord: User edits to "Hello world"  
IRC:     [EDIT] username: Hello world (was: Hello wrold)

Discord: User deletes message
IRC:     [DELETED] username deleted: Hello world
```

**Configuration:**
- Edit window: 5 minutes (configurable in code)
- Message history: Up to 1000 recent messages tracked
- Automatic cleanup: Messages older than 24 hours are purged
- Bulk delete threshold: Shows summary for Discord purge operations

**Technical Details:**
- Uses Discord partial message support for edit/delete events
- Integrates with the persistence service for data survival
- Non-blocking async processing to avoid impact on regular messages
- Memory-efficient cleanup to prevent resource exhaustion
- Full integration with slash command status reporting

### Rate Limiting and Anti-Spam Protection

The bot includes comprehensive rate limiting and anti-spam protection to prevent message flooding and abuse from both Discord and IRC users.

**Features:**
- 🚦 **Multi-level Rate Limiting** - Burst protection, per-minute, and per-hour limits
- 🛡️ **Spam Detection** - Detects duplicate message spam with configurable thresholds
- ⚠️ **Progressive Penalties** - Warning system with escalating consequences
- 🔄 **Automatic Recovery** - Users are automatically unblocked after cooldown periods
- 📊 **Admin Management** - Slash commands for monitoring and manual intervention
- 💾 **Memory Efficient** - Automatic cleanup of old user activity data

**Default Limits:**
- **Burst Limit**: 5 messages in 10 seconds
- **Per-Minute**: 20 messages per minute
- **Per-Hour**: 300 messages per hour
- **Duplicate Spam**: 3 identical messages in 30 seconds triggers block
- **Cooldowns**: 30 seconds for rate limits, 5 minutes for spam detection

**Configuration:**
```json
{
  "rateLimiting": {
    "maxMessagesPerMinute": 20,
    "maxMessagesPerHour": 300,
    "duplicateMessageThreshold": 3,
    "duplicateTimeWindow": 30000,
    "burstLimit": 5,
    "burstWindow": 10000,
    "spamCooldownMinutes": 5,
    "rateLimitCooldownSeconds": 30
  }
}
```

**Admin Commands:**
- `/irc-ratelimit status` - Show detailed rate limiting statistics
- `/irc-ratelimit blocked` - List currently blocked users
- `/irc-ratelimit unblock <user>` - Manually unblock a specific user
- `/irc-ratelimit clear <user>` - Clear warnings for a specific user

**How it works:**
```
User sends too many messages quickly:
Discord/IRC: ⚠️ Rate Limit Warning: burst limit exceeded (5/5 in 10s). Please wait 30 seconds...

After 3 warnings, user is temporarily blocked:
Discord/IRC: 🚫 User blocked for 5 minutes due to repeated rate limit violations

Spam detection (duplicate messages):
Discord/IRC: 🛡️ Spam detected: duplicate message spam detected (3 identical messages). User blocked for 5 minutes.
```

**User Experience:**
- Rate limit warnings are sent via Discord DM or IRC private message
- Clear feedback about why messages were blocked and when they can try again
- Progressive system gives users multiple chances before blocking
- Automatic unblocking ensures temporary issues don't cause permanent problems

### Comprehensive Monitoring and Metrics

The bot includes a sophisticated metrics collection and monitoring system that tracks all aspects of bridge operation for performance analysis, troubleshooting, and capacity planning.

**Features:**
- 📊 **Real-time Metrics** - Live tracking of message flow, user activity, and system performance
- 📈 **Historical Analytics** - Persistent storage of key metrics with automatic cleanup
- 🔍 **Detailed Breakdowns** - Separate tracking for Discord/IRC, commands, attachments, edits, deletions
- ⚡ **Performance Monitoring** - Message latency, error rates, connection stability
- 🎯 **Rate Limiting Insights** - Blocked messages, warnings, spam detection statistics
- 💬 **Private Message Analytics** - PM thread creation, message exchange tracking
- 📡 **HTTP API** - RESTful endpoints for external monitoring systems
- 🎛️ **Admin Controls** - Discord slash commands for metrics management

**Tracked Metrics:**
- **Message Flow**: Discord↔IRC message counts, direction-specific statistics
- **User Activity**: Unique users, peak concurrent usage, top active users/channels
- **System Performance**: Message latency, error rates, uptime tracking
- **Rate Limiting**: Blocked messages, user warnings, spam detection events
- **Private Messages**: Thread creation, message exchange, archive events
- **Technical Health**: Connection errors, webhook failures, reconnection events
- **Command Usage**: Regular commands vs slash commands, processing statistics

**HTTP Monitoring API:**
```bash
# Basic health check
GET http://localhost:3001/health

# Comprehensive metrics summary
GET http://localhost:3001/metrics

# Prometheus format (for Grafana/monitoring tools)
GET http://localhost:3001/metrics/prometheus

# Detailed breakdown of all metrics
GET http://localhost:3001/metrics/detailed

# Recent activity (last hour)
GET http://localhost:3001/metrics/recent
```

**Configuration:**
```json
{
  "metricsPort": 3001
}
```

**Discord Slash Commands:**
- `/irc-metrics summary` - Overview with key statistics and top users/channels
- `/irc-metrics detailed` - Complete breakdown of all tracked metrics
- `/irc-metrics recent` - Activity from the last hour
- `/irc-metrics export` - Download Prometheus format metrics file
- `/irc-metrics reset` - Reset all metrics (admin only)

**Integration Examples:**

*Prometheus + Grafana:*
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'discord-irc-bridge'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/metrics/prometheus'
    scrape_interval: 30s
```

*Simple Monitoring Script:*
```bash
#!/bin/bash
# Check bridge health and alert if needed
HEALTH=$(curl -s http://localhost:3001/health | jq -r '.status')
if [ "$HEALTH" != "ok" ]; then
  echo "Bridge health check failed!" | mail -s "IRC Bridge Alert" admin@example.com
fi
```

**Sample Metrics Output:**
```json
{
  "summary": {
    "totalMessages": 15847,
    "messagesPerHour": 234.2,
    "uniqueUsers": 156,
    "errorRate": 0.02,
    "averageLatency": 45,
    "uptime": 2419200000,
    "topChannels": [
      {"channel": "#general", "messages": 8934},
      {"channel": "#dev", "messages": 4532}
    ],
    "topUsers": [
      {"user": "alice (Discord)", "messages": 1205},
      {"user": "bob (IRC)", "messages": 987}
    ]
  }
}
```

**Benefits:**
- **Performance Optimization**: Identify bottlenecks and optimize message flow
- **Capacity Planning**: Track growth trends and plan infrastructure scaling  
- **Issue Detection**: Proactive monitoring alerts for errors and anomalies
- **User Insights**: Understand usage patterns and popular channels/users
- **Rate Limit Tuning**: Analyze blocked messages to optimize rate limiting
- **Historical Analysis**: Long-term trends for community growth and engagement

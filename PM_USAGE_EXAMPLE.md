# Private Messages Usage Example

This document provides a practical example of how to use the private messaging feature in discord-irc.

## Setup Example

### 1. Discord Server Setup
```
Your Discord Server
├── #general
├── #random
├── #private-messages  ← Create this channel for PMs
└── (other channels...)
```

### 2. Bot Configuration
```json
{
  "nickname": "discord-bot",
  "server": "irc.libera.chat",
  "discordToken": "YOUR_BOT_TOKEN",
  "channelMapping": {
    "#general": "#your-irc-channel"
  },
  "privateMessages": {
    "channelId": "#private-messages",
    "threadPrefix": "PM: ",
    "autoArchive": 60
  }
}
```

### 3. Required Discord Permissions
Ensure your bot has these permissions in the `#private-messages` channel:
- ✅ View Channel
- ✅ Send Messages  
- ✅ Create Public Threads
- ✅ Send Messages in Threads
- ✅ Manage Threads
- ✅ Read Message History

## Usage Scenarios

### Scenario 1: IRC User Starts Conversation

**IRC Side:**
```
/msg discord-bot Hello! Can you help me with Discord?
```

**What Happens:**
1. Bot receives PM from IRC user `john_doe`
2. Bot creates thread in `#private-messages` named "PM: john_doe"
3. Bot sends formatted message to the thread:
   ```
   **<john_doe>** Hello! Can you help me with Discord?
   ```

**Discord Side:**
- New thread appears: 🧵 **PM: john_doe**
- Thread contains the message from IRC
- Discord users can reply in the thread

### Scenario 2: Discord User Replies

**Discord Side (in thread):**
```
@DiscordUser: Sure! What do you need help with?
```

**What Happens:**
1. Bot detects message in PM thread 
2. Bot extracts IRC nickname from thread name: `john_doe`
3. Bot sends PM to IRC user:
   ```
   [PM from DiscordUser] Sure! What do you need help with?
   ```

### Scenario 3: IRC User Changes Nickname

**IRC Side:**
```
/nick john_smith
```

**What Happens:**
1. Bot detects nick change event
2. Thread name updates: "PM: john_doe" → "PM: john_smith"  
3. Notification appears in thread:
   ```
   🔄 IRC user changed nickname: `john_doe` → `john_smith`
   ```

### Scenario 4: Sending Attachments

**Discord Side (in thread):**
- User uploads an image: `screenshot.png`

**IRC Side receives:**
```
[PM from DiscordUser] [Attachment: screenshot.png] https://cdn.discordapp.com/attachments/.../screenshot.png
```

## Thread Lifecycle

### Thread States
1. **Active** - Recent messages, thread is open
2. **Archived** - No messages for 60 minutes (or configured time)
3. **Reactivated** - New message unarchives the thread

### Example Timeline
```
10:00 AM  IRC user sends PM          → Thread created
10:05 AM  Discord user replies       → Thread active
11:05 AM  No activity for 60 min     → Thread auto-archived
02:30 PM  IRC user sends another PM  → Thread unarchived
```

## Error Handling

### Common Issues and Solutions

**Thread creation fails:**
```json
{
  "error": "Missing permissions",
  "solution": "Grant bot 'Create Public Threads' permission"
}
```

**PM channel not found:**
```json
{
  "error": "PM channel not configured", 
  "solution": "Set privateMessages.channelId in config"
}
```

**Thread not found:**
- Thread was deleted: New PM creates fresh thread
- Bot restarts: Searches for existing thread by name

## Advanced Usage

### Custom Thread Prefix
```json
{
  "privateMessages": {
    "threadPrefix": "💬 Chat with ",
    "channelId": "#private-messages"
  }
}
```
Result: Thread named "💬 Chat with john_doe"

### Shorter Auto-Archive
```json
{
  "privateMessages": {
    "autoArchive": 10,  // Archive after 10 minutes
    "channelId": "#private-messages"
  }
}
```

### Multiple Bot Setup
```json
{
  "privateMessages": {
    "threadPrefix": "LiberaChat PM: ",  // Distinguish different networks
    "channelId": "#libera-private-messages"
  }
}
```

## Best Practices

1. **Dedicated Channel**: Use a separate channel for PMs to avoid clutter
2. **Clear Naming**: Use descriptive thread prefixes for multiple networks
3. **Permissions**: Set restrictive permissions on PM channel if needed
4. **Monitoring**: Check bot logs for PM-related errors
5. **User Education**: Inform users about the PM feature and how to use it

## Railway Environment Variables

For Railway deployment, use these environment variables:
```bash
PM_CHANNEL_ID=123456789012345678    # Discord channel ID
PM_THREAD_PREFIX="PM: "             # Thread name prefix  
PM_AUTO_ARCHIVE=60                  # Minutes until auto-archive
```
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord-IRC bridge bot that connects Discord and IRC channels by sending messages back and forth. It's written in TypeScript and uses Node.js with the discord.js and irc-upd libraries.

## Core Architecture

- **Bot class** (`lib/bot.ts`): Main bot implementation that manages both Discord and IRC connections
- **CLI** (`lib/cli.ts`): Command-line interface for starting the bot with configuration
- **Helpers** (`lib/helpers.ts`): Factory function to create and connect bot instances
- **Formatting** (`lib/formatting.ts`): Message formatting between Discord and IRC formats
- **Configuration**: JSON or JS config files that define server connections, channel mappings, and bot behavior

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run the bot (after building)
npm start -- --config /path/to/config.json

# Development workflow
npm run build && npm start -- --config test/fixtures/test-config.json

# Code quality
npm run lint        # ESLint with TypeScript rules
npm run format      # Prettier formatting

# Testing
npm test           # Run all tests with Vitest
npm run test:watch # Watch mode for tests
npm run coverage   # Test coverage report
```

## Configuration Structure

The bot accepts configuration as an array of bot configurations. Each bot config requires:
- `server`: IRC server to connect to
- `nickname`: IRC nickname for the bot
- `discordToken`: Discord bot token
- `channelMapping`: Object mapping Discord channels to IRC channels

See `test/fixtures/` for example configurations and `README.md` for full configuration options.

## Key Components

- **Message bridging**: Bidirectional message passing between Discord and IRC
- **Webhooks**: Optional Discord webhook support for better message formatting
- **Channel mapping**: Flexible mapping between Discord and IRC channels
- **IRC formatting**: Handles IRC color codes and formatting
- **User management**: Nickname handling, user ignoring, and parallel ping fixes

## Test Structure

Tests use Vitest with mocked Discord and IRC clients. Key test files:
- `test/bot.test.ts`: Main bot functionality
- `test/bot-events.test.ts`: Event handling tests
- `test/formatting.test.ts`: Message formatting tests
- `test/stubs/`: Mock implementations for Discord and IRC clients
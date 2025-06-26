#!/usr/bin/env node

import { serve } from 'bun';
import { resolve } from 'node:path';
import fs from 'node:fs';
import stripJsonComments from 'strip-json-comments';
import * as helpers from './helpers';

function readJSONConfig(filePath: string): unknown {
  const configFile = fs.readFileSync(filePath, { encoding: 'utf8' });
  return JSON.parse(stripJsonComments(configFile));
}

async function readJSConfig(filePath: string): Promise<unknown> {
  const { default: config } = await import(filePath);
  return config;
}

async function loadConfig(): Promise<Record<string, unknown>> {
  // Support both config file and environment variables
  const configPath = process.env.CONFIG_PATH || process.env.DISCORD_IRC_CONFIG;
  
  if (configPath) {
    const completePath = resolve(process.cwd(), configPath);
    const config = completePath.endsWith('.json')
      ? readJSONConfig(completePath)
      : await readJSConfig(completePath);
    
    if (!config || typeof config !== 'object') {
      throw new Error(`Invalid config file format: ${configPath}`);
    }
    return config as Record<string, unknown>;
  }

  // Use environment variables if no config file specified
  const envConfig = {
    nickname: process.env.IRC_NICKNAME || process.env.NICKNAME,
    server: process.env.IRC_SERVER || process.env.SERVER,
    discordToken: process.env.DISCORD_TOKEN,
    channelMapping: JSON.parse(process.env.CHANNEL_MAPPING || '{}'),
    ircOptions: JSON.parse(process.env.IRC_OPTIONS || '{}'),
    commandCharacters: JSON.parse(process.env.COMMAND_CHARACTERS || '[]'),
    parallelPingFix: process.env.PARALLEL_PING_FIX === 'true',
    ircNickColor: process.env.IRC_NICK_COLOR !== 'false',
    ircStatusNotices: process.env.IRC_STATUS_NOTICES === 'true',
    announceSelfJoin: process.env.ANNOUNCE_SELF_JOIN === 'true',
    ignoreUsers: JSON.parse(process.env.IGNORE_USERS || '{}'),
    webhooks: JSON.parse(process.env.WEBHOOKS || '{}'),
    autoSendCommands: JSON.parse(process.env.AUTO_SEND_COMMANDS || '[]'),
    privateMessages: {
      channelId: process.env.PM_CHANNEL_ID || process.env.PM_CHANNEL,
      threadPrefix: process.env.PM_THREAD_PREFIX || 'PM: ',
      autoArchive: parseInt(process.env.PM_AUTO_ARCHIVE || '60', 10),
    },
  };

  // Validate required fields
  if (!envConfig.nickname || !envConfig.server || !envConfig.discordToken) {
    throw new Error('Missing required environment variables: IRC_NICKNAME, IRC_SERVER, DISCORD_TOKEN');
  }

  return envConfig;
}

async function startBot() {
  try {
    const config = await loadConfig();
    await helpers.createBot(config);
    console.log('Discord-IRC bridge started successfully');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the health check server
const port = parseInt(process.env.PORT || '3000', 10);

serve({
  port,
  hostname: '0.0.0.0',
  fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'discord-irc-bridge'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/') {
      return new Response('Discord-IRC Bridge is running', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Health server listening on http://0.0.0.0:${port}`);
console.log(`Health endpoint available at http://0.0.0.0:${port}/health`);

// Start the Discord-IRC bot
void startBot();
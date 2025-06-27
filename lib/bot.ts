import irc from 'irc-upd';
import discord, {
  AnyChannel,
  BaseGuildTextChannel,
  CommandInteraction,
  Intents,
  TextChannel,
  WebhookClient,
} from 'discord.js';
import { logger } from './logger';
import { validateChannelMapping } from './validators';
import { formatFromDiscordToIRC, formatFromIRCToDiscord } from './formatting';
import { PersistenceService } from './persistence';
import { registerSlashCommands, handleSlashCommand } from './slash-commands';
import { MessageSynchronizer } from './message-sync';
import { RateLimiter, RateLimitConfig } from './rate-limiter';
import { MetricsCollector } from './metrics';
import { MetricsServer } from './metrics-server';
import { RecoveryManager, RecoveryConfig } from './recovery-manager';
import { S3Uploader, S3Config } from './s3-uploader';

// Usernames need to be between 2 and 32 characters for webhooks:
const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 32;

const REQUIRED_FIELDS = [
  'server',
  'nickname',
  'channelMapping',
  'discordToken',
];
const DEFAULT_NICK_COLORS = [
  'light_blue',
  'dark_blue',
  'light_red',
  'dark_red',
  'light_green',
  'dark_green',
  'magenta',
  'light_magenta',
  'orange',
  'yellow',
  'cyan',
  'light_cyan',
];
const patternMatch = /{\$(.+?)}/g;

/**
 * An IRC bot, works as a middleman for all communication
 * @param {object} options - server, nickname, channelMapping, outgoingToken, incomingURL
 */
class Bot {
  discord: discord.Client;

  server;
  nickname;
  ircOptions;
  discordToken;
  commandCharacters: string[];
  ircNickColor;
  ircNickColors;
  parallelPingFix;
  channels;
  ircStatusNotices;
  announceSelfJoin;
  webhookOptions;
  ignoreUsers;

  format;
  formatIRCText;
  formatURLAttachment;
  formatCommandPrelude;
  formatDiscord;
  formatWebhookAvatarURL;
  channelUsers;
  channelMapping;
  webhooks: Record<string, { id: unknown; client: WebhookClient }>;
  invertedMapping;
  autoSendCommands;
  ircClient;

  // Private Message functionality
  privateMessages;
  pmChannelId;
  pmThreadPrefix;
  pmAutoArchive;
  pmThreads: Map<string, string>; // ircNick -> threadId mapping

  // Persistence service
  persistence: PersistenceService;
  
  // Message synchronization
  messageSync: MessageSynchronizer;
  
  // Rate limiting
  rateLimiter: RateLimiter;
  
  // Metrics collection
  metrics: MetricsCollector;
  
  // Metrics HTTP server
  metricsServer?: MetricsServer;
  
  // Error recovery and reconnection
  recoveryManager: RecoveryManager;
  
  // S3 file upload service (optional)
  s3Uploader?: S3Uploader;

  constructor(options: Record<string, unknown>) {
    for (const field of REQUIRED_FIELDS) {
      if (!options[field]) {
        throw new Error(`Missing configuration field: ${field}`);
      }
    }

    validateChannelMapping(options.channelMapping);

    this.discord = new discord.Client({
      retryLimit: 3,
      intents: [
        Intents.FLAGS.GUILDS, 
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
      ],
      partials: ['MESSAGE'], // Enable partial message support for edit/delete events
    });

    this.server = options.server;
    this.nickname = options.nickname;
    this.ircOptions = options.ircOptions;
    
    // Initialize persistence service
    this.persistence = new PersistenceService(options.dbPath as string);
    this.discordToken = options.discordToken;
    this.commandCharacters = (options.commandCharacters as string[]) || [];
    this.ircNickColor = options.ircNickColor !== false; // default to true
    this.ircNickColors = options.ircNickColors || DEFAULT_NICK_COLORS;
    this.parallelPingFix = options.parallelPingFix === true; // default: false
    this.channels = Object.values(
      options.channelMapping as Record<string, string>,
    );
    this.ircStatusNotices = options.ircStatusNotices;
    this.announceSelfJoin = options.announceSelfJoin;
    this.webhookOptions = options.webhooks;

    // Nicks to ignore
    this.ignoreUsers = options.ignoreUsers || {};
    this.ignoreUsers.irc = this.ignoreUsers.irc || [];
    this.ignoreUsers.discord = this.ignoreUsers.discord || [];
    this.ignoreUsers.discordIds = this.ignoreUsers.discordIds || [];

    // "{$keyName}" => "variableValue"
    // author/nickname: nickname of the user who sent the message
    // discordChannel: Discord channel (e.g. #general)
    // ircChannel: IRC channel (e.g. #irc)
    // text: the (appropriately formatted) message content
    this.format = options.format || {};

    // "{$keyName}" => "variableValue"
    // displayUsername: nickname with wrapped colors
    // attachmentURL: the URL of the attachment (only applicable in formatURLAttachment)
    this.formatIRCText = this.format.ircText || '<{$displayUsername}> {$text}';
    this.formatURLAttachment =
      this.format.urlAttachment || '<{$displayUsername}> {$attachmentURL}';

    // "{$keyName}" => "variableValue"
    // side: "Discord" or "IRC"
    if ('commandPrelude' in this.format) {
      this.formatCommandPrelude = this.format.commandPrelude;
    } else {
      this.formatCommandPrelude = 'Command sent from {$side} by {$nickname}:';
    }

    // "{$keyName}" => "variableValue"
    // withMentions: text with appropriate mentions reformatted
    this.formatDiscord =
      this.format.discord || '**<{$author}>** {$withMentions}';

    // "{$keyName} => "variableValue"
    // nickname: nickame of IRC message sender
    this.formatWebhookAvatarURL = this.format.webhookAvatarURL;

    // Keep track of { channel => [list, of, usernames] } for ircStatusNotices
    this.channelUsers = {};

    this.channelMapping = {};
    this.invertedMapping = {};
    this.webhooks = {};

    // Remove channel passwords from the mapping and lowercase IRC channel names
    for (const [discordChan, ircChan] of Object.entries(
      options.channelMapping as Record<string, string>,
    )) {
      const splut = ircChan.split(' ')[0].toLowerCase();
      this.channelMapping[discordChan] = splut;
      this.invertedMapping[splut] = discordChan;
    }

    this.autoSendCommands = options.autoSendCommands || [];

    // Private Message configuration
    this.privateMessages = options.privateMessages || {};
    this.pmChannelId = this.privateMessages.channelId || this.privateMessages.channel;
    this.pmThreadPrefix = this.privateMessages.threadPrefix || 'PM: ';
    this.pmAutoArchive = this.privateMessages.autoArchive || 60; // minutes
    this.pmThreads = new Map();
    
    // Initialize message synchronization
    this.messageSync = new MessageSynchronizer(this);
    
    // Initialize rate limiting
    const rateLimitConfig = options.rateLimiting as Partial<RateLimitConfig> || {};
    this.rateLimiter = new RateLimiter(rateLimitConfig);
    
    // Initialize metrics collection
    try {
      this.metrics = new MetricsCollector(this.persistence);
    } catch (error) {
      logger.warn('Failed to initialize metrics with persistence, using in-memory metrics:', error);
      this.metrics = new MetricsCollector(null);
    }
    
    // Initialize metrics HTTP server (optional, disabled by default)
    const metricsPort = options.metricsPort as number;
    if (metricsPort) {
      this.metricsServer = new MetricsServer(this.metrics, metricsPort);
    }
    
    // Initialize error recovery manager
    try {
      const recoveryConfig = options.recovery as Partial<RecoveryConfig> || {};
      this.recoveryManager = new RecoveryManager(recoveryConfig);
      this.setupRecoveryHandlers();
    } catch (error) {
      logger.warn('Failed to initialize recovery manager:', error);
      // Create a minimal recovery manager for tests
      this.recoveryManager = new RecoveryManager();
      this.setupRecoveryHandlers();
    }
    
    // Initialize S3 uploader (optional)
    const s3Config = this.loadS3Config(options.s3 as Partial<S3Config>);
    if (s3Config) {
      try {
        this.s3Uploader = new S3Uploader(s3Config);
        // Test connection on initialization
        this.s3Uploader.testConnection().then(result => {
          if (!result.success) {
            logger.error('S3 connection test failed, disabling S3 uploads:', result.error);
            this.s3Uploader = undefined;
          }
        });
      } catch (error) {
        logger.error('Failed to initialize S3 uploader:', error);
        this.s3Uploader = undefined;
      }
    }
  }

  async connect(): Promise<void> {
    logger.debug('Connecting to IRC and Discord');
    
    // Initialize persistence service first
    await this.persistence.initialize();
    
    // Load existing data from persistence
    this.pmThreads = await this.persistence.getAllPMThreads();
    const channelUsersData = await this.persistence.getAllChannelUsers();
    
    // Convert Set data back to the expected format
    for (const [channel, users] of Object.entries(channelUsersData)) {
      this.channelUsers[channel] = users;
    }
    
    // Load message sync history from persistence
    await this.messageSync.loadHistoryFromPersistence();
    
    await this.discord.login(this.discordToken);

    // Extract id and token from Webhook urls and connect.
    for (const [channel, url] of Object.entries(
      (this.webhookOptions ?? {}) as Record<string, string>,
    )) {
      const [id, token] = url.split('/').slice(-2);
      // TODO: surely this is completely wrong, the types do not allow anything like this
      const client = new discord.WebhookClient(id as any, token as any);
      this.webhooks[channel] = {
        id,
        client,
      };
    }

    const ircOptions = {
      userName: this.nickname,
      realName: this.nickname,
      channels: this.channels,
      floodProtection: true,
      floodProtectionDelay: 500,
      retryCount: 10,
      autoRenick: true,
      // options specified in the configuration file override the above defaults
      ...this.ircOptions,
    };

    // default encoding to UTF-8 so messages to Discord aren't corrupted
    if (!Object.prototype.hasOwnProperty.call(ircOptions, 'encoding')) {
      if (irc.canConvertEncoding()) {
        ircOptions.encoding = 'utf-8';
      } else {
        logger.warn(
          'Cannot convert message encoding; you may encounter corrupted characters with non-English text.\n' +
            'For information on how to fix this, please see: https://github.com/Throne3d/node-irc#character-set-detection',
        );
      }
    }

    this.ircClient = new irc.Client(this.server, this.nickname, ircOptions);
    this.attachListeners();
    
    // Start metrics HTTP server if configured
    if (this.metricsServer) {
      this.metricsServer.start();
    }
  }

  async disconnect() {
    this.ircClient.disconnect();
    this.discord.destroy();
    for (const x of Object.values(this.webhooks)) {
      x.client.destroy();
    }
    // Save message sync history to persistence
    await this.messageSync.saveHistoryToPersistence();
    // Stop metrics HTTP server
    if (this.metricsServer) {
      this.metricsServer.stop();
    }
    // Cleanup metrics collector
    this.metrics.destroy();
    // Cleanup rate limiter
    this.rateLimiter.destroy();
    // Cleanup recovery manager
    this.recoveryManager.destroy();
    // Close persistence service
    await this.persistence.close();
  }
  
  private setupRecoveryHandlers(): void {
    // Handle recovery attempts
    this.recoveryManager.on('attemptReconnection', async (service: 'discord' | 'irc', callback: (success: boolean) => void) => {
      try {
        logger.info(`Attempting to reconnect ${service}...`);
        
        if (service === 'discord') {
          const success = await this.reconnectDiscord();
          callback(success);
        } else if (service === 'irc') {
          const success = await this.reconnectIRC();
          callback(success);
        }
      } catch (error) {
        logger.error(`Reconnection attempt failed for ${service}:`, error);
        callback(false);
      }
    });

    // Log recovery events
    this.recoveryManager.on('recoveryStarted', (service, error) => {
      logger.warn(`🔄 Recovery started for ${service}: ${error.message}`);
      this.metrics.recordConnectionError();
    });

    this.recoveryManager.on('recoverySucceeded', (service, attempt) => {
      logger.info(`✅ Recovery successful for ${service} on attempt ${attempt}`);
      this.metrics.recordSuccess();
    });

    this.recoveryManager.on('recoveryFailed', (service, error) => {
      logger.error(`❌ Recovery failed for ${service}: ${error.message}`);
      this.metrics.recordError();
    });

    this.recoveryManager.on('circuitBreakerTripped', (service, health) => {
      logger.error(`🚫 Circuit breaker tripped for ${service} after ${health.consecutiveFailures} failures`);
    });

    this.recoveryManager.on('circuitBreakerReset', (service) => {
      logger.info(`🔓 Circuit breaker reset for ${service}`);
    });

    this.recoveryManager.on('serviceSilent', (service, health) => {
      logger.warn(`⚠️ ${service} has been silent for ${Date.now() - health.lastSuccessful}ms`);
    });
  }

  /**
   * Attempt to reconnect Discord client
   */
  private async reconnectDiscord(): Promise<boolean> {
    try {
      logger.info('Reconnecting Discord client...');
      
      // Destroy existing client if it exists and is connected
      if (this.discord.ws && this.discord.ws.status !== 5) { // 5 = Disconnected
        this.discord.destroy();
      }
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Create new Discord client
      this.discord = new discord.Client({
        retryLimit: 3,
        intents: [
          discord.Intents.FLAGS.GUILDS, 
          discord.Intents.FLAGS.GUILD_MESSAGES,
          discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS
        ],
        partials: ['MESSAGE']
      });
      
      // Re-attach Discord listeners
      this.attachDiscordListeners();
      
      // Login
      await this.discord.login(this.discordToken);
      
      // Wait for ready state
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Discord connection timeout'));
        }, 30000);
        
        this.discord.once('ready', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
      });
      
      // Re-register slash commands
      await registerSlashCommands(this);
      
      logger.info('Discord reconnection successful');
      this.metrics.recordDiscordReconnect();
      this.recoveryManager.recordSuccess('discord');
      
      return true;
      
    } catch (error) {
      logger.error('Discord reconnection failed:', error);
      this.recoveryManager.recordFailure('discord', error as Error);
      return false;
    }
  }

  /**
   * Attempt to reconnect IRC client
   */
  private async reconnectIRC(): Promise<boolean> {
    try {
      logger.info('Reconnecting IRC client...');
      
      // Disconnect existing client
      if (this.ircClient && this.ircClient.readyState === 'open') {
        this.ircClient.disconnect();
      }
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Create new IRC client
      const ircOptions = {
        userName: this.nickname,
        realName: this.nickname,
        channels: this.channels,
        floodProtection: true,
        floodProtectionDelay: 500,
        retryCount: 10,
        autoRenick: true,
        ...this.ircOptions,
      };
      
      this.ircClient = new irc.Client(this.server, this.nickname, ircOptions);
      
      // Re-attach IRC listeners
      this.attachIRCListeners();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('IRC connection timeout'));
        }, 30000);
        
        this.ircClient.once('registered', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
        
        this.ircClient.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      
      logger.info('IRC reconnection successful');
      this.metrics.recordIRCReconnect();
      this.recoveryManager.recordSuccess('irc');
      
      return true;
      
    } catch (error) {
      logger.error('IRC reconnection failed:', error);
      this.recoveryManager.recordFailure('irc', error as Error);
      return false;
    }
  }

  attachListeners() {
    this.attachDiscordListeners();
    this.attachIRCListeners();
  }

  private attachDiscordListeners() {
    this.discord.on('ready', async () => {
      logger.info('Connected to Discord');
      
      // Register slash commands when bot is ready
      await registerSlashCommands(this);
      
      // Record successful connection
      this.recoveryManager.recordSuccess('discord');
      
      // Save uptime start metric
      if (this.persistence) {
        await this.persistence.saveMetric('uptime_start', Date.now().toString());
      }
    });

    this.discord.on('error', (error) => {
      logger.error('Received error event from Discord', error);
      this.metrics.recordConnectionError();
      this.recoveryManager.recordFailure('discord', error);
    });

    this.discord.on('disconnect', () => {
      logger.warn('Discord client disconnected');
      this.recoveryManager.recordFailure('discord', new Error('Discord client disconnected'));
    });

    this.discord.on('reconnecting', () => {
      logger.info('Discord client attempting to reconnect');
    });

    this.discord.on('warn', (warning) => {
      logger.warn('Received warn event from Discord', warning);
    });

    this.discord.on('message', (message) => {
      // Quick check: is this a PM thread message?
      if (message.channel && 
          typeof message.channel.isThread === 'function' && 
          message.channel.isThread() && 
          message.channel.name && 
          message.channel.name.startsWith(this.pmThreadPrefix)) {
        // Handle PM thread message asynchronously
        this.handleDiscordPrivateMessage(message).catch((error) => {
          logger.error('Error handling Discord PM:', error);
        });
        return;
      }
      
      // Handle regular channel messages immediately
      this.sendToIRC(message);
    });

    // Handle slash command interactions
    this.discord.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;
      
      await handleSlashCommand(interaction, this);
    });

    // Handle message edits and deletions
    this.discord.on('messageUpdate', async (oldMessage, newMessage) => {
      await this.messageSync.handleMessageEdit(oldMessage, newMessage);
    });

    this.discord.on('messageDelete', async (message) => {
      await this.messageSync.handleMessageDelete(message);
    });

    this.discord.on('messageDeleteBulk', async (messages) => {
      await this.messageSync.handleBulkDelete(messages);
    });
  }

  private attachIRCListeners() {
    this.ircClient.on('registered', (message) => {
      logger.info('Connected to IRC');
      logger.debug('Registered event: ', message);
      
      // Record successful connection
      this.recoveryManager.recordSuccess('irc');
      
      for (const element of this.autoSendCommands) {
        this.ircClient.send(...element);
      }
    });

    this.ircClient.on('error', (error) => {
      logger.error('Received error event from IRC', error);
      this.metrics.recordConnectionError();
      this.recoveryManager.recordFailure('irc', error);
    });

    this.ircClient.on('abort', () => {
      logger.warn('IRC connection aborted');
      this.recoveryManager.recordFailure('irc', new Error('IRC connection aborted'));
    });

    this.ircClient.on('close', () => {
      logger.warn('IRC connection closed');
      this.recoveryManager.recordFailure('irc', new Error('IRC connection closed'));
    });

    this.ircClient.on('netError', (error) => {
      logger.error('IRC network error:', error);
      this.recoveryManager.recordFailure('irc', error);
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('message', this.sendToDiscord.bind(this));

    // Handle private messages from IRC users
    this.ircClient.on('pm', async (from, text) => {
      await this.handleIrcPrivateMessage(from, text);
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('notice', async (author, to, text) =>
      this.sendToDiscord(author, to, `*${text}*`),
    );

    // TODO: almost certainly not async safe
    this.ircClient.on('nick', async (oldNick, newNick, channels) => {
      // Update PM thread mapping for nick changes (don't await to avoid blocking)
      this.updatePmThreadForNickChange(oldNick, newNick).catch((error) => {
        logger.error('Error updating PM thread for nick change:', error);
      });
      
      if (!this.ircStatusNotices) return;
      for (const channelName of channels) {
        const channel = channelName.toLowerCase();
        if (this.channelUsers[channel]) {
          if (this.channelUsers[channel].has(oldNick)) {
            this.channelUsers[channel].delete(oldNick);
            this.channelUsers[channel].add(newNick);
            await this.sendExactToDiscord(
              channel,
              `*${oldNick}* is now known as ${newNick}`,
            );
            // Save updated channel users to persistence (don't await to avoid blocking)
            this.saveChannelUsersToPersistence(channel).catch((error) => {
              logger.error('Failed to save channel users after nick change:', error);
            });
          }
        } else {
          logger.warn(
            `No channelUsers found for ${channel} when ${oldNick} changed.`,
          );
        }
      }
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('join', async (channelName, nick) => {
      logger.debug('Received join:', channelName, nick);
      if (!this.ircStatusNotices) return;
      if (nick === this.ircClient.nick && !this.announceSelfJoin) return;
      const channel = channelName.toLowerCase();
      // self-join is announced before names (which includes own nick)
      // so don't add nick to channelUsers
      if (nick !== this.ircClient.nick) {
        this.channelUsers[channel].add(nick);
        // Save updated channel users to persistence (don't await to avoid blocking)
        this.saveChannelUsersToPersistence(channel).catch((error) => {
          logger.error('Failed to save channel users after join:', error);
        });
      }
      await this.sendExactToDiscord(
        channel,
        `*${nick}* has joined the channel`,
      );
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('part', async (channelName, nick, reason) => {
      logger.debug('Received part:', channelName, nick, reason);
      if (!this.ircStatusNotices) return;
      const channel = channelName.toLowerCase();
      // remove list of users when no longer in channel (as it will become out of date)
      if (nick === this.ircClient.nick) {
        logger.debug('Deleting channelUsers as bot parted:', channel);
        delete this.channelUsers[channel];
        return;
      }
      if (this.channelUsers[channel]) {
        this.channelUsers[channel].delete(nick);
        // Save updated channel users to persistence (don't await to avoid blocking)
        this.saveChannelUsersToPersistence(channel).catch((error) => {
          logger.error('Failed to save channel users after part:', error);
        });
      } else {
        logger.warn(
          `No channelUsers found for ${channel} when ${nick} parted.`,
        );
      }
      await this.sendExactToDiscord(
        channel,
        `*${nick}* has left the channel (${reason})`,
      );
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('quit', async (nick, reason, channels) => {
      logger.debug('Received quit:', nick, channels);
      if (!this.ircStatusNotices || nick === this.ircClient.nick) return;
      for (const channelName of channels) {
        const channel = channelName.toLowerCase();
        if (!this.channelUsers[channel]) {
          logger.warn(
            `No channelUsers found for ${channel} when ${nick} quit, ignoring.`,
          );
          continue;
        }
        if (!this.channelUsers[channel].delete(nick)) continue;
        await this.sendExactToDiscord(
          channel,
          `*${nick}* has quit (${reason})`,
        );
      }
    });

    this.ircClient.on('names', (channelName, nicks) => {
      logger.debug('Received names:', channelName, nicks);
      if (!this.ircStatusNotices) return;
      const channel = channelName.toLowerCase();
      this.channelUsers[channel] = new Set(Object.keys(nicks));
      // Save initial channel users to persistence (don't await to avoid blocking)
      this.saveChannelUsersToPersistence(channel).catch((error) => {
        logger.error('Failed to save initial channel users:', error);
      });
    });

    // TODO: almost certainly not async safe
    this.ircClient.on('action', async (author, to, text) =>
      this.sendToDiscord(author, to, `_${text}_`),
    );

    this.ircClient.on('invite', (channel, from) => {
      logger.debug('Received invite:', channel, from);
      if (!this.invertedMapping[channel]) {
        logger.debug('Channel not found in config, not joining:', channel);
      } else {
        this.ircClient.join(channel);
        logger.debug('Joining channel:', channel);
      }
    });

    if (logger.level === 'debug') {
      this.discord.on('debug', (message) => {
        logger.debug('Received debug event from Discord', message);
      });
    }
  }

  static getDiscordNicknameOnServer(user, guild) {
    if (guild) {
      const userDetails = guild.members.cache.get(user.id);
      if (userDetails) {
        return userDetails.nickname || user.username;
      }
    }
    return user.username;
  }

  parseText(message: discord.Message): string {
    const usedFields = ['title', 'description', 'fields', 'image', 'footer'];
    let embed = '';
    if (message.embeds?.length) {
      for (const key of usedFields) {
        if (!message.embeds[0][key]) {
          continue;
        }
        if (key === 'fields') {
          for (const field of message.embeds[0][key]) {
            let { value } = field;
            const discId = value.match(/<@[0-9]+>/g);
            if (discId) {
              for (const id of discId) {
                const dId = id.substring(2, id.length - 1);
                const name = (this.discord.users as any).find(
                  'id',
                  dId,
                ).username;
                value = value.replace(id, name);
              }
            }
            embed += `\u0002${field.name}\u0002\n${value}\n`;
          }
        } else if (key === 'image') {
          embed += `${message.embeds[0][key].url}\n`;
        } else if (key === 'footer') {
          embed += message.embeds[0][key].text;
        } else if (key === 'title') {
          embed += `\u0002${message.embeds[0][key]}\u0002\n`;
        } else {
          embed += `${message.embeds[0][key]}\n`;
        }
      }
    }
    let text = message.mentions.users.reduce((content, mention) => {
      const displayName = Bot.getDiscordNicknameOnServer(
        mention,
        message.guild,
      );
      const userMentionRegex = RegExp(`<@(&|!)?${mention.id}>`, 'g');
      return content.replace(userMentionRegex, `@${displayName}`);
    }, message.content);

    text = `${text}\n${embed}`;
    text = text.trim();

    return text
      .replace(/<#(\d+)>/g, (match, channelId) => {
        const channel = this.discord.channels.cache.get(channelId);
        if (channel && 'name' in channel) return `#${channel.name}`;
        return '#deleted-channel';
      })
      .replace(/<@&(\d+)>/g, (match, roleId) => {
        const role = message.guild?.roles.cache.get(roleId);
        if (role) return `@${role.name}`;
        return '@deleted-role';
      })
      .replace(/<a?(:\w+:)\d+>/g, (match, emoteName) => emoteName);
  }

  isCommandMessage(message: string) {
    return this.commandCharacters.some((prefix) => message.startsWith(prefix));
  }

  ignoredIrcUser(user) {
    return this.ignoreUsers.irc.some(
      (i) => i.toLowerCase() === user.toLowerCase(),
    );
  }

  ignoredDiscordUser(discordUser: discord.User) {
    const ignoredName = this.ignoreUsers.discord.some(
      (i) => i.toLowerCase() === discordUser.username.toLowerCase(),
    );
    const ignoredId = this.ignoreUsers.discordIds.some(
      (i) => i === discordUser.id,
    );
    return ignoredName || ignoredId;
  }

  static substitutePattern(message: string, patternMapping) {
    return message.replace(
      patternMatch,
      (match, varName) => patternMapping[varName] || match,
    );
  }

  async sendToIRC(message: discord.Message) {
    const { author } = message;
    // Ignore messages sent by the bot itself:
    if (
      author.id === this.discord.user?.id ||
      Object.keys(this.webhooks).some(
        (channel) => this.webhooks[channel].id === author.id,
      )
    )
      return;

    // Do not send to IRC if this user is on the ignore list.
    if (this.ignoredDiscordUser(author)) {
      return;
    }

    // Check rate limiting
    const messageContent = this.parseText(message);
    const rateLimitResult = this.rateLimiter.checkMessage(
      author.id, 
      author.username, 
      messageContent
    );
    
    if (rateLimitResult) {
      logger.warn(`Message from ${author.username} (${author.id}) blocked by rate limiter: ${rateLimitResult}`);
      
      // Record blocked message
      this.metrics.recordMessageBlocked();
      if (rateLimitResult.includes('warning')) {
        this.metrics.recordUserWarned();
      } else if (rateLimitResult.includes('blocked')) {
        this.metrics.recordUserBlocked();
      }
      if (rateLimitResult.includes('spam')) {
        this.metrics.recordSpamDetected();
      }
      
      // Send warning to Discord user via DM (optional, can be disabled)
      try {
        const warningMessage = `⚠️ **Rate Limit Warning**\n\n${rateLimitResult}\n\nPlease slow down your message sending rate.`;
        await author.send(warningMessage);
      } catch (error) {
        logger.debug(`Could not send rate limit warning DM to ${author.username}:`, error);
      }
      
      return; // Block the message
    }

    if (!isTextChannel(message.channel)) return;

    const channelName = `#${message.channel.name}`;
    const ircChannel =
      this.channelMapping[message.channel.id] ||
      this.channelMapping[channelName];

    logger.debug(
      'Channel Mapping',
      channelName,
      this.channelMapping[channelName],
    );
    if (ircChannel) {
      const fromGuild = message.guild;
      const nickname = Bot.getDiscordNicknameOnServer(author, fromGuild);
      let text = messageContent; // Already parsed for rate limiting
      let displayUsername = nickname;

      if (this.parallelPingFix) {
        // Prevent users of both IRC and Discord from
        // being mentioned in IRC when they talk in Discord.
        displayUsername = `${displayUsername.slice(
          0,
          1,
        )}\u200B${displayUsername.slice(1)}`;
      }

      if (this.ircNickColor) {
        const colorIndex =
          (nickname.charCodeAt(0) + nickname.length) %
          this.ircNickColors.length;
        displayUsername = irc.colors.wrap(
          this.ircNickColors[colorIndex],
          displayUsername,
        );
      }

      const patternMap = {
        author: nickname,
        nickname,
        displayUsername,
        text,
        discordChannel: channelName,
        ircChannel,
        side: undefined as unknown,
        attachmentURL: undefined as unknown,
      };

      if (this.isCommandMessage(text)) {
        patternMap.side = 'Discord';
        logger.debug('Sending command message to IRC', ircChannel, text);
        // if (prelude) this.ircClient.say(ircChannel, prelude);
        if (this.formatCommandPrelude) {
          const prelude = Bot.substitutePattern(
            this.formatCommandPrelude,
            patternMap,
          );
          this.ircClient.say(ircChannel, prelude);
        }
        this.ircClient.say(ircChannel, text);
        
        // Record metrics
        this.metrics.recordDiscordToIRC(author.id, ircChannel);
        this.metrics.recordCommand();
        
        // Record command message for edit/delete tracking
        this.messageSync.recordMessage(message.id, ircChannel, text, nickname);
      } else {
        if (text !== '') {
          // Convert formatting

          text = text.replace('\r\n', '\n').replace('\r', '\n');
          const sentences = text.split('\n');

          for (const orig of sentences) {
            let sentence = formatFromDiscordToIRC(orig);
            if (sentence) {
              patternMap.text = sentence;
              sentence = Bot.substitutePattern(this.formatIRCText, patternMap);
              logger.debug('Sending message to IRC', ircChannel, sentence);
              this.ircClient.say(ircChannel, sentence);
              
              // Record each sentence for edit/delete tracking
              this.messageSync.recordMessage(message.id, ircChannel, sentence, nickname);
            }
          }
          
          // Record metrics for the whole message (not per sentence)
          if (sentences.some(s => formatFromDiscordToIRC(s))) {
            this.metrics.recordDiscordToIRC(author.id, ircChannel);
          }
        }

        if (message.attachments && message.attachments.size) {
          // attachments are a discord.Collection, not a JS object
          for (const [, attachment] of message.attachments) {
            // Try to upload to S3 first, fall back to Discord URL
            let attachmentURL = attachment.url;
            
            if (this.s3Uploader) {
              try {
                const s3Url = await this.uploadAttachmentToS3(attachment);
                if (s3Url) {
                  attachmentURL = s3Url;
                  logger.debug('Using S3 URL for attachment:', attachment.name);
                } else {
                  logger.debug('S3 upload failed, using Discord URL for attachment:', attachment.name);
                }
              } catch (error) {
                logger.warn('S3 upload error, using Discord URL:', error);
              }
            }
            
            patternMap.attachmentURL = attachmentURL;
            const urlMessage = Bot.substitutePattern(
              this.formatURLAttachment,
              patternMap,
            );

            logger.debug(
              'Sending attachment URL to IRC',
              ircChannel,
              urlMessage,
            );
            this.ircClient.say(ircChannel, urlMessage);
            
            // Record attachment metrics
            this.metrics.recordAttachment();
            
            // Record attachment URL for edit/delete tracking
            this.messageSync.recordMessage(message.id, ircChannel, urlMessage, nickname);
          }
        }
      }
    }
  }

  findDiscordChannel(ircChannel: string) {
    const discordChannelName = this.invertedMapping[ircChannel.toLowerCase()];
    if (discordChannelName) {
      // #channel -> channel before retrieving and select only text channels:
      let discordChannel: BaseGuildTextChannel | undefined;

      if (this.discord.channels.cache.has(discordChannelName)) {
        discordChannel = this.discord.channels.cache.get(discordChannelName) as
          | BaseGuildTextChannel
          | undefined;
      } else if (discordChannelName.startsWith('#')) {
        discordChannel = this.discord.channels.cache
          // unclear if this UNKNOWN is a test bug or happens in the real world
          .filter(
            (c: any) =>
              c.type === 'text' ||
              c.type === 'UNKNOWN' ||
              c.type === 'GUILD_TEXT',
          )
          .find(
            (c) =>
              (c as BaseGuildTextChannel).name === discordChannelName.slice(1),
          ) as BaseGuildTextChannel | undefined;
      }

      if (!discordChannel) {
        logger.info(
          "Tried to send a message to a channel the bot isn't in: ",
          discordChannelName,
        );
        return null;
      }
      return discordChannel;
    }
    return null;
  }

  findWebhook(ircChannel: string) {
    const discordChannelName = this.invertedMapping[ircChannel.toLowerCase()];
    return discordChannelName && this.webhooks[discordChannelName];
  }

  getDiscordAvatar(nick: string, channel: string) {
    const discordChannel = this.findDiscordChannel(channel);
    if (!discordChannel) return null;
    const guildMembers = discordChannel.guild.members.cache;
    const findByNicknameOrUsername = (caseSensitive) => (member) => {
      if (caseSensitive) {
        return member.user.username === nick || member.nickname === nick;
      }
      const nickLowerCase = nick.toLowerCase();
      return (
        member.user.username.toLowerCase() === nickLowerCase ||
        (member.nickname && member.nickname.toLowerCase() === nickLowerCase)
      );
    };

    // Try to find exact matching case
    let users = guildMembers.filter(findByNicknameOrUsername(true));

    // Now let's search case insensitive.
    if (users.size === 0) {
      users = guildMembers.filter(findByNicknameOrUsername(false));
    }

    // No matching user or more than one => default avatar
    if (users && users.size === 1) {
      const url = users.first()?.user.avatarURL({ size: 128, format: 'png' });
      if (url) return url;
    }

    // If there isn't a URL format, don't send an avatar at all
    if (this.formatWebhookAvatarURL) {
      return Bot.substitutePattern(this.formatWebhookAvatarURL, {
        nickname: nick,
      });
    }
    return null;
  }

  // compare two strings case-insensitively
  // for discord mention matching
  static caseComp(str1, str2) {
    return str1.toUpperCase() === str2.toUpperCase();
  }

  // check if the first string starts with the second case-insensitively
  // for discord mention matching
  static caseStartsWith(str1, str2) {
    return str1.toUpperCase().startsWith(str2.toUpperCase());
  }

  async sendToDiscord(author, channel, text) {
    const discordChannel = this.findDiscordChannel(channel);
    if (!discordChannel) return;

    // Do not send to Discord if this user is on the ignore list.
    if (this.ignoredIrcUser(author)) {
      return;
    }

    // Check rate limiting for IRC users
    const rateLimitResult = this.rateLimiter.checkMessage(
      `irc:${author}`, // Use IRC nickname with prefix to distinguish from Discord IDs
      author,
      text
    );
    
    if (rateLimitResult) {
      logger.warn(`Message from IRC user ${author} blocked by rate limiter: ${rateLimitResult}`);
      
      // Record blocked message metrics
      this.metrics.recordMessageBlocked();
      if (rateLimitResult.includes('warning')) {
        this.metrics.recordUserWarned();
      } else if (rateLimitResult.includes('blocked')) {
        this.metrics.recordUserBlocked();
      }
      if (rateLimitResult.includes('spam')) {
        this.metrics.recordSpamDetected();
      }
      
      // Send warning to IRC user via private message
      try {
        this.ircClient.say(author, `⚠️ Rate Limit Warning: ${rateLimitResult}. Please slow down your message sending rate.`);
      } catch (error) {
        logger.debug(`Could not send rate limit warning PM to ${author}:`, error);
      }
      
      return; // Block the message
    }

    // Convert text formatting (bold, italics, underscore)
    const withFormat = formatFromIRCToDiscord(text);

    const patternMap = {
      author,
      nickname: author,
      displayUsername: author,
      text: withFormat,
      discordChannel: `#${discordChannel.name}`,
      ircChannel: channel,
      side: undefined as unknown,
      withMentions: undefined as unknown,
      withFilteredMentions: undefined as unknown,
    };

    if (this.isCommandMessage(text)) {
      patternMap.side = 'IRC';
      logger.debug(
        'Sending command message to Discord',
        `#${discordChannel.name}`,
        text,
      );
      if (this.formatCommandPrelude) {
        const prelude = Bot.substitutePattern(
          this.formatCommandPrelude,
          patternMap,
        );
        await discordChannel.send(prelude);
      }
      await discordChannel.send(text);
      
      // Record metrics for command
      this.metrics.recordIRCToDiscord(author, channel);
      this.metrics.recordCommand();
      
      return;
    }

    const { guild } = discordChannel;
    const withMentions = withFormat
      // @ts-expect-error TS doesn't seem to see the valid overload of replace here?
      .replace(/@([^\s#]+)#(\d+)/g, (match, username, discriminator) => {
        // @username#1234 => mention
        // skips usernames including spaces for ease (they cannot include hashes)
        // checks case insensitively as Discord does
        const user = guild.members.cache.find(
          (x) =>
            Bot.caseComp(x.user.username, username) &&
            x.user.discriminator === discriminator,
        );
        if (user) return user;

        return match;
      })
      // @ts-expect-error TS doesn't seem to see the valid overload of replace here?
      .replace(/:(\w+):/g, (match, ident) => {
        // :emoji: => mention, case sensitively
        const emoji = guild.emojis.cache.find(
          // @ts-expect-error TS doesn't seem to see the valid overload of replace here?
          (x) => x.name === ident && x.requiresColons,
        );
        if (emoji) return emoji;

        return match;
      })
      // @ts-expect-error TS doesn't seem to see the valid overload of replace here?
      .replace(/#([^\s#@'!?,.]+)/g, (match, channelName) => {
        // channel names can't contain spaces, #, @, ', !, ?, , or .
        // (based on brief testing. they also can't contain some other symbols,
        // but these seem likely to be common around channel references)

        // discord matches channel names case insensitively
        const chan = guild.channels.cache.find((x) =>
          Bot.caseComp(x.name, channelName),
        );
        return chan || match;
      });

    // Webhooks first
    const webhook = this.findWebhook(channel);
    if (webhook) {
      logger.debug(
        'Sending message to Discord via webhook',
        withMentions,
        channel,
        '->',
        `#${discordChannel.name}`,
      );
      const permissions = discordChannel.permissionsFor(this.discord.user!);
      let canPingEveryone = false;
      if (permissions) {
        canPingEveryone = permissions.has(
          discord.Permissions.FLAGS.MENTION_EVERYONE,
        );
      }
      const avatarURL = this.getDiscordAvatar(author, channel);
      const username = author
        .substring(0, USERNAME_MAX_LENGTH)
        .padEnd(USERNAME_MIN_LENGTH, '_');
      webhook.client
        .send(withMentions, {
          username,
          avatarURL,
          disableMentions: canPingEveryone ? 'none' : 'everyone',
        })
        .catch((error) => {
          logger.error(error);
          this.metrics.recordWebhookError();
        });
      
      // Record metrics for webhook message
      this.metrics.recordIRCToDiscord(author, channel);
      
      return;
    }

    patternMap.withMentions = withMentions;
    patternMap.withFilteredMentions = withMentions.replace(
      /@(here|everyone)/gi,
      (match, part) => `ම${part}`,
    );

    // Add bold formatting:
    // Use custom formatting from config / default formatting with bold author
    const withAuthor = Bot.substitutePattern(this.formatDiscord, patternMap);
    logger.debug(
      'Sending message to Discord',
      withAuthor,
      channel,
      '->',
      `#${discordChannel.name}`,
    );
    await discordChannel.send(withAuthor);
    
    // Record metrics for regular message
    this.metrics.recordIRCToDiscord(author, channel);
  }

  /* Sends a message to Discord exactly as it appears */
  async sendExactToDiscord(channel: string, text: string): Promise<void> {
    const discordChannel = this.findDiscordChannel(channel);
    if (!discordChannel) return;

    logger.debug(
      'Sending special message to Discord',
      text,
      channel,
      '->',
      `#${discordChannel.name}`,
    );
    await discordChannel.send(text);
  }

  // Private Message functionality
  
  sanitizeNickname(nickname: string): string {
    // Remove/replace characters that could break Discord thread names
    return nickname.replace(/[<>@#&!]/g, '_').substring(0, 80);
  }

  async findPmChannel(): Promise<BaseGuildTextChannel | null> {
    if (!this.pmChannelId) return null;
    
    // Try to find by ID first
    if (this.discord.channels.cache.has(this.pmChannelId)) {
      const channel = this.discord.channels.cache.get(this.pmChannelId);
      if (channel && isTextChannel(channel)) {
        return channel;
      }
    }
    
    // Try to find by name (if pmChannelId starts with #)
    if (this.pmChannelId.startsWith('#')) {
      const channelName = this.pmChannelId.slice(1);
      const channel = this.discord.channels.cache
        .filter((c: any) => 
          c.type === 'GUILD_TEXT' && 
          c.name === channelName
        )
        .first() as BaseGuildTextChannel | undefined;
      
      if (channel) return channel;
    }
    
    return null;
  }

  async findOrCreatePmThread(ircNick: string): Promise<any> {
    const pmChannel = await this.findPmChannel();
    if (!pmChannel) {
      logger.warn('PM channel not found or not configured');
      return null;
    }

    const sanitizedNick = this.sanitizeNickname(ircNick);
    const threadName = `${this.pmThreadPrefix}${sanitizedNick}`;
    
    // Check if we have a cached thread
    const cachedThreadId = this.pmThreads.get(ircNick.toLowerCase());
    if (cachedThreadId) {
      const cachedThread = pmChannel.threads.cache.get(cachedThreadId);
      if (cachedThread) {
        // Unarchive if archived
        if (cachedThread.archived) {
          try {
            await cachedThread.setArchived(false);
          } catch (error) {
            logger.warn('Failed to unarchive PM thread:', error);
          }
        }
        // Update activity timestamp in persistence
        await this.persistence.savePMThread(ircNick, cachedThread.id, pmChannel.id);
        return cachedThread;
      }
    }

    // Search for existing thread by name
    const existingThread = pmChannel.threads.cache.find(
      thread => thread.name === threadName
    );
    
    if (existingThread) {
      this.pmThreads.set(ircNick.toLowerCase(), existingThread.id);
      // Save to persistence
      await this.persistence.savePMThread(ircNick, existingThread.id, pmChannel.id);
      if (existingThread.archived) {
        try {
          await existingThread.setArchived(false);
        } catch (error) {
          logger.warn('Failed to unarchive existing PM thread:', error);
        }
      }
      return existingThread;
    }

    // Create new thread
    try {
      const newThread = await pmChannel.threads.create({
        name: threadName,
        autoArchiveDuration: this.pmAutoArchive,
        reason: `Private message conversation with IRC user ${ircNick}`
      });
      
      this.pmThreads.set(ircNick.toLowerCase(), newThread.id);
      // Save to persistence
      await this.persistence.savePMThread(ircNick, newThread.id, pmChannel.id);
      logger.debug(`Created new PM thread for ${ircNick}: ${newThread.id}`);
      
      // Record PM thread creation metrics
      this.metrics.recordPMThreadCreated();
      
      // Send initial message explaining the thread
      await newThread.send(
        `🔗 **Private message thread with IRC user \`${ircNick}\`**\n` +
        `Messages sent here will be forwarded to ${ircNick} on IRC.\n` +
        `Messages from ${ircNick} will appear in this thread.`
      );
      
      return newThread;
    } catch (error) {
      logger.error('Failed to create PM thread:', error);
      return null;
    }
  }

  async handleIrcPrivateMessage(from: string, text: string): Promise<void> {
    // Check if PM feature is enabled and configured
    if (!this.pmChannelId) {
      logger.debug('Received IRC PM but private messages not configured');
      return;
    }

    // Check if user is ignored
    if (this.ignoredIrcUser(from)) {
      logger.debug(`Ignoring PM from ignored IRC user: ${from}`);
      return;
    }

    logger.debug(`Received IRC PM from ${from}: ${text}`);

    try {
      const thread = await this.findOrCreatePmThread(from);
      if (!thread) {
        logger.warn(`Failed to create/find PM thread for ${from}`);
        return;
      }

      // Format the message similar to regular IRC messages
      const withFormat = formatFromIRCToDiscord(text);
      const patternMap = {
        author: from,
        nickname: from,
        displayUsername: from,
        text: withFormat,
        withMentions: withFormat,
        ircChannel: 'PM',
        discordChannel: thread.name,
      };

      // Apply Discord formatting  
      const formattedMessage = Bot.substitutePattern(this.formatDiscord, patternMap);
      
      await thread.send(formattedMessage);
      logger.debug(`Sent IRC PM to Discord thread: ${from} -> ${thread.name}`);
      
      // Record PM message metrics
      this.metrics.recordPMMessage();
      
    } catch (error) {
      logger.error('Error handling IRC private message:', error);
    }
  }

  async handleDiscordPrivateMessage(message: discord.Message): Promise<boolean> {
    // Check if this is a message in a PM thread
    if (!message.channel.isThread()) return false;
    
    const thread = message.channel;
    const threadName = thread.name;
    
    // Check if this is a PM thread
    if (!threadName.startsWith(this.pmThreadPrefix)) return false;
    
    // Extract IRC nickname from thread name
    const ircNick = threadName.substring(this.pmThreadPrefix.length);
    if (!ircNick) return false;

    // Don't send bot's own messages
    if (message.author.id === this.discord.user?.id) return true;
    
    // Check if user is ignored
    if (this.ignoredDiscordUser(message.author)) {
      logger.debug(`Ignoring PM from ignored Discord user: ${message.author.username}`);
      return true;
    }

    try {
      // Parse and format the message
      let text = this.parseText(message);
      
      if (text.trim() === '') {
        // Handle attachments only
        if (message.attachments && message.attachments.size > 0) {
          for (const [, attachment] of message.attachments) {
            // Try to upload to S3 first, fall back to Discord URL
            let attachmentURL = attachment.url;
            
            if (this.s3Uploader) {
              try {
                const s3Url = await this.uploadAttachmentToS3(attachment);
                if (s3Url) {
                  attachmentURL = s3Url;
                  logger.debug('Using S3 URL for PM attachment:', attachment.name);
                } else {
                  logger.debug('S3 upload failed, using Discord URL for PM attachment:', attachment.name);
                }
              } catch (error) {
                logger.warn('S3 upload error for PM attachment, using Discord URL:', error);
              }
            }
            
            const attachmentMessage = `[Attachment: ${attachment.name}] ${attachmentURL}`;
            this.ircClient.say(ircNick, attachmentMessage);
            logger.debug(`Sent Discord attachment to IRC PM: ${message.author.username} -> ${ircNick}`);
          }
        }
        return true;
      }

      // Format message for IRC (remove Discord formatting)
      text = formatFromDiscordToIRC(text);
      
      // Send to IRC user
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.ircClient.say(ircNick, line);
          logger.debug(`Sent Discord PM to IRC: ${message.author.username} -> ${ircNick}: ${line}`);
        }
      }
      
      // Record PM message metrics (once per message, not per line)
      if (lines.some(line => line.trim())) {
        this.metrics.recordPMMessage();
      }
      
      return true;
    } catch (error) {
      logger.error('Error sending Discord PM to IRC:', error);
      return true; // Still handled, just failed
    }
  }

  async updatePmThreadForNickChange(oldNick: string, newNick: string): Promise<void> {
    const threadId = this.pmThreads.get(oldNick.toLowerCase());
    if (!threadId) return;

    // Update the mapping
    this.pmThreads.delete(oldNick.toLowerCase());
    this.pmThreads.set(newNick.toLowerCase(), threadId);
    
    // Update in persistence
    await this.persistence.updatePMThreadNick(oldNick, newNick);

    // Try to update the thread name
    try {
      const pmChannel = await this.findPmChannel();
      if (pmChannel) {
        const thread = pmChannel.threads.cache.get(threadId);
        if (thread) {
          const sanitizedNewNick = this.sanitizeNickname(newNick);
          const newThreadName = `${this.pmThreadPrefix}${sanitizedNewNick}`;
          await thread.setName(newThreadName);
          
          // Send notification message
          await thread.send(`🔄 IRC user changed nickname: \`${oldNick}\` → \`${newNick}\``);
          
          logger.debug(`Updated PM thread name for nick change: ${oldNick} -> ${newNick}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to update PM thread name for nick change:', error);
    }
  }

  async saveChannelUsersToPersistence(channel: string): Promise<void> {
    try {
      const users = this.channelUsers[channel];
      if (users) {
        await this.persistence.saveChannelUsers(channel, users);
      }
    } catch (error) {
      logger.error('Failed to save channel users to persistence:', error);
    }
  }

  /**
   * Load S3 configuration from options and environment variables
   */
  private loadS3Config(options: Partial<S3Config> = {}): S3Config | null {
    // Load from environment variables with optional prefix
    const config: Partial<S3Config> = {
      region: options.region || process.env.S3_REGION || process.env.AWS_REGION,
      bucket: options.bucket || process.env.S3_BUCKET,
      accessKeyId: options.accessKeyId || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: options.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
      endpoint: options.endpoint || process.env.S3_ENDPOINT,
      forcePathStyle: options.forcePathStyle ?? (process.env.S3_FORCE_PATH_STYLE === 'true'),
      publicUrlBase: options.publicUrlBase || process.env.S3_PUBLIC_URL_BASE,
      keyPrefix: options.keyPrefix || process.env.S3_KEY_PREFIX,
      signedUrlExpiry: options.signedUrlExpiry || (process.env.S3_SIGNED_URL_EXPIRY ? parseInt(process.env.S3_SIGNED_URL_EXPIRY) : undefined),
      ...options
    };

    // Validate required fields
    const validation = S3Uploader.validateConfig(config);
    if (!validation.valid) {
      if (Object.keys(options).length > 0 || process.env.S3_REGION || process.env.S3_BUCKET) {
        logger.warn('S3 configuration incomplete, S3 uploads disabled:', validation.errors);
      } else {
        logger.debug('No S3 configuration provided, S3 uploads disabled');
      }
      return null;
    }

    logger.info('S3 configuration loaded successfully', {
      region: config.region,
      bucket: config.bucket,
      endpoint: config.endpoint,
      hasCustomUrl: !!config.publicUrlBase,
      keyPrefix: config.keyPrefix
    });

    return config as S3Config;
  }

  /**
   * Upload Discord attachment to S3 and return public URL
   */
  async uploadAttachmentToS3(attachment: discord.MessageAttachment, customFilename?: string): Promise<string | null> {
    if (!this.s3Uploader) {
      return null;
    }

    try {
      // Check if file type is supported
      if (!this.s3Uploader.isSupportedFileType(attachment.name || 'unknown')) {
        logger.debug('Unsupported file type for S3 upload:', attachment.name);
        return null;
      }

      // Fetch attachment data
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch attachment: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Upload to S3
      const result = await this.s3Uploader.uploadFile(
        buffer,
        attachment.name || 'unknown',
        customFilename,
        attachment.contentType || undefined
      );

      if (result.success && result.url) {
        logger.info('Attachment uploaded to S3', {
          originalName: attachment.name,
          customName: customFilename,
          s3Url: result.url,
          size: buffer.length
        });

        // Record metrics
        this.metrics.recordAttachment();
        
        return result.url;
      } else {
        logger.error('S3 upload failed:', result.error);
        return null;
      }

    } catch (error) {
      logger.error('Failed to upload attachment to S3:', error);
      return null;
    }
  }
}

export const TEST_HACK_CHANNEL = Symbol();

const isTextChannel = (channel: AnyChannel): channel is TextChannel =>
  channel instanceof BaseGuildTextChannel || TEST_HACK_CHANNEL in channel;

export default Bot;

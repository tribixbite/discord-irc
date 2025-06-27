import { TextChannel, Guild } from 'discord.js';
import { logger } from './logger';

export interface StatusNotificationConfig {
  enabled: boolean;
  useDedicatedChannels: boolean;
  joinLeaveChannelId?: string;    // Discord channel ID for join/leave notifications
  timeoutChannelId?: string;      // Discord channel ID for timeout/kick notifications
  fallbackToMainChannel: boolean; // Fall back to main channel if dedicated channel not found
  includeJoins: boolean;
  includeLeaves: boolean;
  includeQuits: boolean;
  includeKicks: boolean;
  includeTimeouts: boolean;
  includeBotEvents: boolean;      // Include bot's own join/leave events
  joinMessage: string;
  leaveMessage: string;
  quitMessage: string;
  kickMessage: string;
  timeoutMessage: string;
}

export interface StatusNotificationChannels {
  joinLeave?: TextChannel;
  timeout?: TextChannel;
}

export class StatusNotificationManager {
  private config: StatusNotificationConfig;
  private channels: Map<string, StatusNotificationChannels> = new Map(); // guildId -> channels

  constructor(config: Partial<StatusNotificationConfig> = {}) {
    this.config = {
      enabled: true,
      useDedicatedChannels: true,
      fallbackToMainChannel: true,
      includeJoins: true,
      includeLeaves: true,
      includeQuits: true,
      includeKicks: true,
      includeTimeouts: true,
      includeBotEvents: false,
      joinMessage: '*{nick}* has joined {channel}',
      leaveMessage: '*{nick}* has left {channel}',
      quitMessage: '*{nick}* has quit ({reason})',
      kickMessage: '*{nick}* was kicked from {channel} ({reason})',
      timeoutMessage: '*{nick}* was timed out in {channel} ({reason})',
      ...config
    };

    logger.info('Status notification manager initialized with config:', {
      enabled: this.config.enabled,
      useDedicatedChannels: this.config.useDedicatedChannels,
      joinLeaveChannelId: this.config.joinLeaveChannelId,
      timeoutChannelId: this.config.timeoutChannelId
    });
  }

  /**
   * Initialize dedicated channels for a guild
   */
  async initializeChannels(guild: Guild): Promise<void> {
    if (!this.config.enabled || !this.config.useDedicatedChannels) {
      return;
    }

    const channels: StatusNotificationChannels = {};

    // Find join/leave channel
    if (this.config.joinLeaveChannelId) {
      try {
        const joinLeaveChannel = await guild.channels.fetch(this.config.joinLeaveChannelId);
        if (joinLeaveChannel?.isText()) {
          channels.joinLeave = joinLeaveChannel as TextChannel;
          logger.info(`Found join/leave notification channel: ${joinLeaveChannel.name}`);
        }
      } catch (error) {
        logger.warn(`Failed to find join/leave notification channel ${this.config.joinLeaveChannelId}:`, error);
      }
    }

    // Find timeout channel
    if (this.config.timeoutChannelId) {
      try {
        const timeoutChannel = await guild.channels.fetch(this.config.timeoutChannelId);
        if (timeoutChannel?.isText()) {
          channels.timeout = timeoutChannel as TextChannel;
          logger.info(`Found timeout notification channel: ${timeoutChannel.name}`);
        }
      } catch (error) {
        logger.warn(`Failed to find timeout notification channel ${this.config.timeoutChannelId}:`, error);
      }
    }

    this.channels.set(guild.id, channels);
  }

  /**
   * Send a join notification
   */
  async sendJoinNotification(
    nick: string, 
    channelName: string, 
    fallbackChannel: TextChannel,
    isBotEvent: boolean = false
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.includeJoins) {
      return false;
    }

    if (isBotEvent && !this.config.includeBotEvents) {
      return false;
    }

    const message = this.formatMessage(this.config.joinMessage, {
      nick,
      channel: channelName,
      reason: ''
    });

    return await this.sendNotification(message, 'joinLeave', fallbackChannel);
  }

  /**
   * Send a leave notification
   */
  async sendLeaveNotification(
    nick: string, 
    channelName: string, 
    reason: string = '', 
    fallbackChannel: TextChannel,
    isBotEvent: boolean = false
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.includeLeaves) {
      return false;
    }

    if (isBotEvent && !this.config.includeBotEvents) {
      return false;
    }

    const message = this.formatMessage(this.config.leaveMessage, {
      nick,
      channel: channelName,
      reason
    });

    return await this.sendNotification(message, 'joinLeave', fallbackChannel);
  }

  /**
   * Send a quit notification
   */
  async sendQuitNotification(
    nick: string, 
    reason: string = '', 
    fallbackChannel: TextChannel,
    isBotEvent: boolean = false
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.includeQuits) {
      return false;
    }

    if (isBotEvent && !this.config.includeBotEvents) {
      return false;
    }

    const message = this.formatMessage(this.config.quitMessage, {
      nick,
      channel: '',
      reason
    });

    return await this.sendNotification(message, 'joinLeave', fallbackChannel);
  }

  /**
   * Send a kick notification
   */
  async sendKickNotification(
    nick: string, 
    channelName: string, 
    reason: string = '', 
    fallbackChannel: TextChannel
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.includeKicks) {
      return false;
    }

    const message = this.formatMessage(this.config.kickMessage, {
      nick,
      channel: channelName,
      reason
    });

    return await this.sendNotification(message, 'timeout', fallbackChannel);
  }

  /**
   * Send a timeout notification
   */
  async sendTimeoutNotification(
    nick: string, 
    channelName: string, 
    reason: string = '', 
    fallbackChannel: TextChannel
  ): Promise<boolean> {
    if (!this.config.enabled || !this.config.includeTimeouts) {
      return false;
    }

    const message = this.formatMessage(this.config.timeoutMessage, {
      nick,
      channel: channelName,
      reason
    });

    return await this.sendNotification(message, 'timeout', fallbackChannel);
  }

  /**
   * Send notification to appropriate channel
   */
  private async sendNotification(
    message: string, 
    channelType: 'joinLeave' | 'timeout', 
    fallbackChannel: TextChannel
  ): Promise<boolean> {
    if (!this.config.useDedicatedChannels) {
      // Send to fallback channel if not using dedicated channels
      try {
        await fallbackChannel.send(message);
        logger.debug(`Sent status notification to fallback channel: ${message}`);
        return true;
      } catch (error) {
        logger.error('Failed to send status notification to fallback channel:', error);
        return false;
      }
    }

    const guildChannels = this.channels.get(fallbackChannel.guild.id);
    const targetChannel = guildChannels?.[channelType];

    if (targetChannel) {
      try {
        await targetChannel.send(message);
        logger.debug(`Sent status notification to ${channelType} channel: ${message}`);
        return true;
      } catch (error) {
        logger.error(`Failed to send status notification to ${channelType} channel:`, error);
        
        // Fall back to main channel if configured
        if (this.config.fallbackToMainChannel) {
          try {
            await fallbackChannel.send(message);
            logger.debug(`Sent status notification to fallback channel after error: ${message}`);
            return true;
          } catch (fallbackError) {
            logger.error('Failed to send status notification to fallback channel:', fallbackError);
          }
        }
        return false;
      }
    } else {
      // No dedicated channel found
      if (this.config.fallbackToMainChannel) {
        try {
          await fallbackChannel.send(message);
          logger.debug(`Sent status notification to fallback channel (no dedicated): ${message}`);
          return true;
        } catch (error) {
          logger.error('Failed to send status notification to fallback channel:', error);
          return false;
        }
      } else {
        logger.debug(`No ${channelType} channel configured and fallback disabled, skipping notification`);
        return false;
      }
    }
  }

  /**
   * Format message with placeholders
   */
  private formatMessage(
    template: string, 
    variables: { nick: string; channel: string; reason: string }
  ): string {
    return template
      .replace(/{nick}/g, variables.nick)
      .replace(/{channel}/g, variables.channel)
      .replace(/{reason}/g, variables.reason)
      .replace(/\s*\(\)\s*/g, '') // Remove empty parentheses when reason is empty
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<StatusNotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Status notification configuration updated:', newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): StatusNotificationConfig {
    return { ...this.config };
  }

  /**
   * Get configured channels for a guild
   */
  getChannels(guildId: string): StatusNotificationChannels | undefined {
    return this.channels.get(guildId);
  }

  /**
   * Check if notifications are enabled for a specific type
   */
  isNotificationEnabled(type: 'join' | 'leave' | 'quit' | 'kick' | 'timeout'): boolean {
    if (!this.config.enabled) return false;

    switch (type) {
      case 'join': return this.config.includeJoins;
      case 'leave': return this.config.includeLeaves;
      case 'quit': return this.config.includeQuits;
      case 'kick': return this.config.includeKicks;
      case 'timeout': return this.config.includeTimeouts;
      default: return false;
    }
  }

  /**
   * Load configuration from environment variables or config
   */
  static loadConfig(options: any = {}): Partial<StatusNotificationConfig> {
    return {
      enabled: options.statusNotifications?.enabled ?? (process.env.STATUS_NOTIFICATIONS_ENABLED !== 'false'),
      useDedicatedChannels: options.statusNotifications?.useDedicatedChannels ?? (process.env.STATUS_NOTIFICATIONS_USE_DEDICATED_CHANNELS !== 'false'),
      joinLeaveChannelId: options.statusNotifications?.joinLeaveChannelId || process.env.STATUS_NOTIFICATIONS_JOIN_LEAVE_CHANNEL_ID,
      timeoutChannelId: options.statusNotifications?.timeoutChannelId || process.env.STATUS_NOTIFICATIONS_TIMEOUT_CHANNEL_ID,
      fallbackToMainChannel: options.statusNotifications?.fallbackToMainChannel ?? (process.env.STATUS_NOTIFICATIONS_FALLBACK_TO_MAIN !== 'false'),
      includeJoins: options.statusNotifications?.includeJoins ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_JOINS !== 'false'),
      includeLeaves: options.statusNotifications?.includeLeaves ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_LEAVES !== 'false'),
      includeQuits: options.statusNotifications?.includeQuits ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_QUITS !== 'false'),
      includeKicks: options.statusNotifications?.includeKicks ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_KICKS !== 'false'),
      includeTimeouts: options.statusNotifications?.includeTimeouts ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_TIMEOUTS !== 'false'),
      includeBotEvents: options.statusNotifications?.includeBotEvents ?? (process.env.STATUS_NOTIFICATIONS_INCLUDE_BOT_EVENTS === 'true'),
      joinMessage: options.statusNotifications?.joinMessage || process.env.STATUS_NOTIFICATIONS_JOIN_MESSAGE,
      leaveMessage: options.statusNotifications?.leaveMessage || process.env.STATUS_NOTIFICATIONS_LEAVE_MESSAGE,
      quitMessage: options.statusNotifications?.quitMessage || process.env.STATUS_NOTIFICATIONS_QUIT_MESSAGE,
      kickMessage: options.statusNotifications?.kickMessage || process.env.STATUS_NOTIFICATIONS_KICK_MESSAGE,
      timeoutMessage: options.statusNotifications?.timeoutMessage || process.env.STATUS_NOTIFICATIONS_TIMEOUT_MESSAGE
    };
  }
}
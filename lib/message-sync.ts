import { Message, PartialMessage } from 'discord.js';
import { logger } from './logger';
import Bot from './bot';

export interface MessageRecord {
  discordMessageId: string;
  ircChannel: string;
  ircMessage: string;
  timestamp: number;
  author: string;
}

export class MessageSynchronizer {
  private bot: Bot;
  private messageHistory: Map<string, MessageRecord> = new Map();
  private readonly maxHistorySize = 1000; // Keep last 1000 messages
  private readonly editWindow = 5 * 60 * 1000; // 5 minutes edit window

  constructor(bot: Bot) {
    this.bot = bot;
  }

  /**
   * Record a message that was sent from Discord to IRC
   */
  recordMessage(discordMessageId: string, ircChannel: string, ircMessage: string, author: string): void {
    const record: MessageRecord = {
      discordMessageId,
      ircChannel,
      ircMessage,
      timestamp: Date.now(),
      author
    };

    this.messageHistory.set(discordMessageId, record);

    // Clean up old messages to prevent memory leaks
    if (this.messageHistory.size > this.maxHistorySize) {
      this.cleanupOldMessages();
    }

    logger.debug(`Recorded message ${discordMessageId} -> ${ircChannel}: ${ircMessage.substring(0, 50)}...`);
  }

  /**
   * Handle Discord message edit
   */
  async handleMessageEdit(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
    try {
      // Skip if not a full message or if it's from the bot itself
      if (!newMessage.id || !newMessage.content || newMessage.author?.bot) {
        return;
      }

      // If it's a partial message, try to fetch the full message
      let fullMessage: Message;
      if (newMessage.partial) {
        try {
          fullMessage = await newMessage.fetch();
        } catch (error) {
          logger.warn(`Failed to fetch full message for edit ${newMessage.id}:`, error);
          return;
        }
      } else {
        fullMessage = newMessage as Message;
      }

      const messageRecord = this.messageHistory.get(fullMessage.id);
      if (!messageRecord) {
        logger.debug(`No record found for edited message ${fullMessage.id}`);
        return;
      }

      // Check if edit is within the allowed window
      const timeSinceOriginal = Date.now() - messageRecord.timestamp;
      if (timeSinceOriginal > this.editWindow) {
        logger.debug(`Edit window expired for message ${fullMessage.id} (${timeSinceOriginal}ms ago)`);
        return;
      }

      // Format the new message content
      const formattedContent = this.bot.parseText(fullMessage);
      if (!formattedContent || formattedContent.trim() === '') {
        logger.debug(`Skipping edit with empty content for message ${fullMessage.id}`);
        return;
      }

      // Check if content actually changed
      if (formattedContent === messageRecord.ircMessage) {
        logger.debug(`No content change detected for message ${fullMessage.id}`);
        return;
      }

      // Send edit notification to IRC
      const editNotification = `[EDIT] ${messageRecord.author}: ${formattedContent} (was: ${messageRecord.ircMessage})`;
      
      // Use the same sending mechanism as regular messages
      if (this.bot.ircClient && this.bot.ircClient.readyState === 'open') {
        this.bot.ircClient.say(messageRecord.ircChannel, editNotification);
        logger.info(`Sent edit notification to ${messageRecord.ircChannel}: ${messageRecord.author} edited message`);
        
        // Record edit metrics
        this.bot.metrics.recordEdit();
        
        // Update the record with new content
        messageRecord.ircMessage = formattedContent;
        messageRecord.timestamp = Date.now(); // Update timestamp for edit window
      } else {
        logger.warn('IRC client not ready, cannot send edit notification');
      }

    } catch (error) {
      logger.error('Error handling message edit:', error);
    }
  }

  /**
   * Handle Discord message deletion
   */
  async handleMessageDelete(message: Message | PartialMessage): Promise<void> {
    try {
      if (!message.id) return;

      const messageRecord = this.messageHistory.get(message.id);
      if (!messageRecord) {
        logger.debug(`No record found for deleted message ${message.id}`);
        return;
      }

      // Check if deletion is within the allowed window
      const timeSinceOriginal = Date.now() - messageRecord.timestamp;
      if (timeSinceOriginal > this.editWindow) {
        logger.debug(`Delete window expired for message ${message.id} (${timeSinceOriginal}ms ago)`);
        // Still remove from history but don't notify IRC
        this.messageHistory.delete(message.id);
        return;
      }

      // Send deletion notification to IRC
      const deleteNotification = `[DELETED] ${messageRecord.author} deleted: ${messageRecord.ircMessage}`;
      
      if (this.bot.ircClient && this.bot.ircClient.readyState === 'open') {
        this.bot.ircClient.say(messageRecord.ircChannel, deleteNotification);
        logger.info(`Sent delete notification to ${messageRecord.ircChannel}: ${messageRecord.author} deleted message`);
        
        // Record delete metrics
        this.bot.metrics.recordDelete();
      } else {
        logger.warn('IRC client not ready, cannot send delete notification');
      }

      // Remove from history
      this.messageHistory.delete(message.id);

    } catch (error) {
      logger.error('Error handling message deletion:', error);
    }
  }

  /**
   * Handle bulk message deletion (Discord purge)
   */
  async handleBulkDelete(messages: ReadonlyMap<string, Message | PartialMessage>): Promise<void> {
    try {
      const deletedCount = messages.size;
      const relevantMessages = Array.from(messages.values())
        .filter(msg => this.messageHistory.has(msg.id!))
        .length;

      if (relevantMessages === 0) {
        logger.debug(`Bulk delete of ${deletedCount} messages, none were tracked`);
        return;
      }

      // For bulk deletes, send a summary rather than individual notifications
      const channels = new Set<string>();
      messages.forEach(message => {
        if (message.id) {
          const record = this.messageHistory.get(message.id);
          if (record) {
            channels.add(record.ircChannel);
            this.messageHistory.delete(message.id);
          }
        }
      });

      // Send bulk delete notification to each affected channel
      for (const channel of channels) {
        const bulkNotification = `[BULK DELETE] ${relevantMessages} messages were deleted from Discord`;
        
        if (this.bot.ircClient && this.bot.ircClient.readyState === 'open') {
          this.bot.ircClient.say(channel, bulkNotification);
          logger.info(`Sent bulk delete notification to ${channel}: ${relevantMessages} messages`);
        }
      }

    } catch (error) {
      logger.error('Error handling bulk message deletion:', error);
    }
  }

  /**
   * Clean up old messages from history
   */
  private cleanupOldMessages(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    let cleanedCount = 0;

    for (const [messageId, record] of this.messageHistory.entries()) {
      if (record.timestamp < cutoffTime) {
        this.messageHistory.delete(messageId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} old message records`);
    }

    // If still too large, remove oldest messages
    if (this.messageHistory.size > this.maxHistorySize) {
      const sortedEntries = Array.from(this.messageHistory.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = this.messageHistory.size - this.maxHistorySize;
      for (let i = 0; i < toRemove; i++) {
        this.messageHistory.delete(sortedEntries[i][0]);
      }
      
      logger.debug(`Removed ${toRemove} oldest message records to maintain size limit`);
    }
  }

  /**
   * Get statistics about message synchronization
   */
  getStats(): {
    trackedMessages: number;
    oldestMessage: number | null;
    editWindowMinutes: number;
  } {
    let oldestTimestamp: number | null = null;
    
    if (this.messageHistory.size > 0) {
      oldestTimestamp = Math.min(...Array.from(this.messageHistory.values()).map(r => r.timestamp));
    }

    return {
      trackedMessages: this.messageHistory.size,
      oldestMessage: oldestTimestamp,
      editWindowMinutes: this.editWindow / (60 * 1000)
    };
  }

  /**
   * Clear all message history (useful for testing or memory management)
   */
  clearHistory(): void {
    const count = this.messageHistory.size;
    this.messageHistory.clear();
    logger.info(`Cleared ${count} message records from history`);
  }

  /**
   * Save message history to persistence (if enabled)
   */
  async saveHistoryToPersistence(): Promise<void> {
    if (!this.bot.persistence) return;

    try {
      const historyData = JSON.stringify(Array.from(this.messageHistory.entries()));
      await this.bot.persistence.saveMetric('message_history', historyData);
      logger.debug('Saved message history to persistence');
    } catch (error) {
      logger.error('Failed to save message history to persistence:', error);
    }
  }

  /**
   * Load message history from persistence (if available)
   */
  async loadHistoryFromPersistence(): Promise<void> {
    if (!this.bot.persistence) return;

    try {
      const historyData = await this.bot.persistence.getMetric('message_history');
      if (historyData) {
        const entries = JSON.parse(historyData) as [string, MessageRecord][];
        this.messageHistory = new Map(entries);
        
        // Clean up old entries after loading
        this.cleanupOldMessages();
        
        logger.info(`Loaded ${this.messageHistory.size} message records from persistence`);
      }
    } catch (error) {
      logger.error('Failed to load message history from persistence:', error);
      this.messageHistory.clear(); // Start fresh if data is corrupted
    }
  }
}
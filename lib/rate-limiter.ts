import { logger } from './logger';

export interface RateLimitConfig {
  // Message rate limiting
  maxMessagesPerMinute: number;
  maxMessagesPerHour: number;
  
  // Spam detection
  duplicateMessageThreshold: number; // How many identical messages trigger spam detection
  duplicateTimeWindow: number; // Time window in ms to check for duplicates
  
  // Flood protection
  burstLimit: number; // Max messages in burst window
  burstWindow: number; // Burst window in ms
  
  // Cooldown periods
  spamCooldownMinutes: number; // How long to ignore user after spam detection
  rateLimitCooldownSeconds: number; // Cooldown after hitting rate limit
}

export interface UserActivity {
  userId: string;
  username: string;
  messageCount: number;
  lastMessage: number;
  recentMessages: number[]; // Timestamps of recent messages
  messageHistory: string[]; // Recent message contents for duplicate detection
  warningCount: number;
  isBlocked: boolean;
  blockedUntil: number;
  lastWarning: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private userActivity: Map<string, UserActivity> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxMessagesPerMinute: 20,
      maxMessagesPerHour: 300,
      duplicateMessageThreshold: 3,
      duplicateTimeWindow: 30 * 1000, // 30 seconds
      burstLimit: 5,
      burstWindow: 10 * 1000, // 10 seconds
      spamCooldownMinutes: 5,
      rateLimitCooldownSeconds: 30,
      ...config
    };

    // Clean up old user activity every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldActivity();
    }, 5 * 60 * 1000);

    logger.info('Rate limiter initialized with config:', this.config);
  }

  /**
   * Check if a user is allowed to send a message
   * Returns null if allowed, or a reason string if blocked
   */
  checkMessage(userId: string, username: string, messageContent: string): string | null {
    const now = Date.now();
    let user = this.userActivity.get(userId);

    if (!user) {
      user = {
        userId,
        username,
        messageCount: 0,
        lastMessage: 0,
        recentMessages: [],
        messageHistory: [],
        warningCount: 0,
        isBlocked: false,
        blockedUntil: 0,
        lastWarning: 0
      };
      this.userActivity.set(userId, user);
    }

    // Update username if it changed
    user.username = username;

    // Check if user is currently blocked
    if (user.isBlocked && now < user.blockedUntil) {
      const remainingTime = Math.ceil((user.blockedUntil - now) / 1000);
      return `User is temporarily blocked for ${remainingTime} seconds due to spam/rate limiting`;
    }

    // Unblock user if cooldown period has passed
    if (user.isBlocked && now >= user.blockedUntil) {
      user.isBlocked = false;
      user.warningCount = 0;
      logger.info(`User ${username} (${userId}) has been unblocked`);
    }

    // Clean old messages from history
    const minuteAgo = now - 60 * 1000;
    const hourAgo = now - 60 * 60 * 1000;
    
    user.recentMessages = user.recentMessages.filter(timestamp => timestamp > hourAgo);
    user.messageHistory = user.messageHistory.slice(-10); // Keep last 10 messages

    // Check burst rate (short-term flooding)
    const recentBurstMessages = user.recentMessages.filter(timestamp => timestamp > now - this.config.burstWindow);
    if (recentBurstMessages.length >= this.config.burstLimit) {
      return this.handleRateLimit(user, `burst limit exceeded (${recentBurstMessages.length}/${this.config.burstLimit} in ${this.config.burstWindow/1000}s)`);
    }

    // Check per-minute rate
    const recentMinuteMessages = user.recentMessages.filter(timestamp => timestamp > minuteAgo);
    if (recentMinuteMessages.length >= this.config.maxMessagesPerMinute) {
      return this.handleRateLimit(user, `per-minute limit exceeded (${recentMinuteMessages.length}/${this.config.maxMessagesPerMinute})`);
    }

    // Check per-hour rate
    if (user.recentMessages.length >= this.config.maxMessagesPerHour) {
      return this.handleRateLimit(user, `per-hour limit exceeded (${user.recentMessages.length}/${this.config.maxMessagesPerHour})`);
    }

    // Check for duplicate messages (spam detection)
    const recentDuplicates = user.messageHistory.filter(msg => 
      msg === messageContent && 
      user.recentMessages.some(timestamp => timestamp > now - this.config.duplicateTimeWindow)
    );

    if (recentDuplicates.length >= this.config.duplicateMessageThreshold - 1) { // -1 because this message would be the nth duplicate
      return this.handleSpam(user, `duplicate message spam detected (${recentDuplicates.length + 1} identical messages)`);
    }

    // Message is allowed - record it
    user.recentMessages.push(now);
    user.messageHistory.push(messageContent);
    user.lastMessage = now;
    user.messageCount++;

    return null; // Message allowed
  }

  /**
   * Handle rate limit violation
   */
  private handleRateLimit(user: UserActivity, reason: string): string {
    user.warningCount++;
    const now = Date.now();

    logger.warn(`Rate limit violation for ${user.username} (${user.userId}): ${reason} (warning ${user.warningCount})`);

    // Progressive penalties
    if (user.warningCount >= 3) {
      // Block user after 3 warnings
      user.isBlocked = true;
      user.blockedUntil = now + (this.config.spamCooldownMinutes * 60 * 1000);
      logger.warn(`User ${user.username} (${user.userId}) blocked for ${this.config.spamCooldownMinutes} minutes due to repeated rate limit violations`);
      return `User blocked for ${this.config.spamCooldownMinutes} minutes due to repeated rate limit violations`;
    } else {
      // Temporary cooldown
      user.blockedUntil = now + (this.config.rateLimitCooldownSeconds * 1000);
      user.lastWarning = now;
      return `Rate limit exceeded: ${reason}. Please wait ${this.config.rateLimitCooldownSeconds} seconds before sending another message.`;
    }
  }

  /**
   * Handle spam detection
   */
  private handleSpam(user: UserActivity, reason: string): string {
    const now = Date.now();
    
    logger.warn(`Spam detected for ${user.username} (${user.userId}): ${reason}`);

    // Immediate block for spam
    user.isBlocked = true;
    user.blockedUntil = now + (this.config.spamCooldownMinutes * 60 * 1000);
    user.warningCount += 2; // Spam is more serious than rate limiting

    return `Spam detected: ${reason}. User blocked for ${this.config.spamCooldownMinutes} minutes.`;
  }

  /**
   * Get statistics about rate limiting
   */
  getStats(): {
    totalUsers: number;
    blockedUsers: number;
    totalMessages: number;
    recentWarnings: number;
    activeUsers: number; // Users active in last hour
  } {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    let blockedUsers = 0;
    let totalMessages = 0;
    let recentWarnings = 0;
    let activeUsers = 0;

    for (const user of this.userActivity.values()) {
      if (user.isBlocked && now < user.blockedUntil) {
        blockedUsers++;
      }
      totalMessages += user.messageCount;
      if (user.lastWarning > dayAgo) {
        recentWarnings++;
      }
      if (user.lastMessage > hourAgo) {
        activeUsers++;
      }
    }

    return {
      totalUsers: this.userActivity.size,
      blockedUsers,
      totalMessages,
      recentWarnings,
      activeUsers
    };
  }

  /**
   * Get user-specific information
   */
  getUserInfo(userId: string): UserActivity | null {
    return this.userActivity.get(userId) || null;
  }

  /**
   * Manually unblock a user (admin function)
   */
  unblockUser(userId: string): boolean {
    const user = this.userActivity.get(userId);
    if (user && user.isBlocked) {
      user.isBlocked = false;
      user.blockedUntil = 0;
      user.warningCount = Math.max(0, user.warningCount - 1); // Reduce warning count
      logger.info(`User ${user.username} (${userId}) manually unblocked`);
      return true;
    }
    return false;
  }

  /**
   * Clear all warnings for a user (admin function)
   */
  clearWarnings(userId: string): boolean {
    const user = this.userActivity.get(userId);
    if (user) {
      user.warningCount = 0;
      user.lastWarning = 0;
      logger.info(`Warnings cleared for user ${user.username} (${userId})`);
      return true;
    }
    return false;
  }

  /**
   * Get list of currently blocked users
   */
  getBlockedUsers(): UserActivity[] {
    const now = Date.now();
    return Array.from(this.userActivity.values())
      .filter(user => user.isBlocked && now < user.blockedUntil);
  }

  /**
   * Clean up old user activity to prevent memory leaks
   */
  private cleanupOldActivity(): void {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;

    for (const [userId, user] of this.userActivity.entries()) {
      // Remove users who haven't been active for a week and aren't blocked
      if (user.lastMessage < oneWeekAgo && (!user.isBlocked || now >= user.blockedUntil)) {
        this.userActivity.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} inactive user records`);
    }
  }

  /**
   * Update rate limit configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Rate limiter configuration updated:', newConfig);
  }

  /**
   * Reset all user activity (admin function - use with caution)
   */
  resetAllUsers(): void {
    const userCount = this.userActivity.size;
    this.userActivity.clear();
    logger.warn(`All user activity reset (${userCount} users cleared)`);
  }

  /**
   * Cleanup when shutting down
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    logger.info('Rate limiter destroyed');
  }
}
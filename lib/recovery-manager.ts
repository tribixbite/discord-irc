import { logger } from './logger';
import { EventEmitter } from 'events';

export interface RecoveryConfig {
  maxRetries: number;
  baseDelay: number; // Base delay in ms for exponential backoff
  maxDelay: number; // Maximum delay in ms
  jitterRange: number; // Random jitter range (0-1)
  healthCheckInterval: number; // Health check interval in ms
  circuitBreakerThreshold: number; // Failed attempts before circuit breaker trips
  circuitBreakerTimeout: number; // Circuit breaker timeout in ms
}

export interface ConnectionHealth {
  isHealthy: boolean;
  lastSuccessful: number;
  consecutiveFailures: number;
  totalFailures: number;
  lastError?: Error;
}

export interface RecoveryAttempt {
  attempt: number;
  timestamp: number;
  delay: number;
  reason: string;
  success: boolean;
  error?: Error;
}

export class RecoveryManager extends EventEmitter {
  private config: RecoveryConfig;
  private discordHealth: ConnectionHealth;
  private ircHealth: ConnectionHealth;
  private healthCheckTimer?: NodeJS.Timeout;
  private recoveryHistory: RecoveryAttempt[] = [];
  private circuitBreakers: Map<string, number> = new Map(); // service -> trip time
  
  // Recovery state
  private isRecovering = false;
  private recoveryPromise?: Promise<void>;

  constructor(config: Partial<RecoveryConfig> = {}) {
    super();
    this.config = {
      maxRetries: 5,
      baseDelay: 1000, // 1 second
      maxDelay: 60000, // 1 minute
      jitterRange: 0.2, // ±20%
      healthCheckInterval: 30000, // 30 seconds
      circuitBreakerThreshold: 3,
      circuitBreakerTimeout: 300000, // 5 minutes
      ...config
    };

    this.discordHealth = this.initializeHealth();
    this.ircHealth = this.initializeHealth();

    this.startHealthChecking();
    logger.info('Recovery manager initialized with config:', this.config);
  }

  private initializeHealth(): ConnectionHealth {
    return {
      isHealthy: true,
      lastSuccessful: Date.now(),
      consecutiveFailures: 0,
      totalFailures: 0
    };
  }

  /**
   * Record a successful operation for a service
   */
  recordSuccess(service: 'discord' | 'irc'): void {
    const health = service === 'discord' ? this.discordHealth : this.ircHealth;
    
    health.isHealthy = true;
    health.lastSuccessful = Date.now();
    health.consecutiveFailures = 0;
    
    // Clear circuit breaker
    this.circuitBreakers.delete(service);
    
    logger.debug(`${service} connection marked as healthy`);
    this.emit('serviceHealthy', service, health);
  }

  /**
   * Record a failure for a service
   */
  recordFailure(service: 'discord' | 'irc', error: Error): void {
    const health = service === 'discord' ? this.discordHealth : this.ircHealth;
    
    health.consecutiveFailures++;
    health.totalFailures++;
    health.lastError = error;
    
    // Check if we should trip the circuit breaker
    if (health.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      health.isHealthy = false;
      this.circuitBreakers.set(service, Date.now());
      logger.warn(`Circuit breaker tripped for ${service} after ${health.consecutiveFailures} failures`);
      this.emit('circuitBreakerTripped', service, health);
    }
    
    logger.error(`${service} connection failure recorded:`, error.message);
    this.emit('serviceUnhealthy', service, health, error);
    
    // Trigger recovery if not already recovering
    this.triggerRecovery(service, error);
  }

  /**
   * Check if a service is available (not in circuit breaker state)
   */
  isServiceAvailable(service: 'discord' | 'irc'): boolean {
    const tripTime = this.circuitBreakers.get(service);
    if (!tripTime) return true;
    
    // Check if circuit breaker timeout has elapsed
    if (Date.now() - tripTime > this.config.circuitBreakerTimeout) {
      this.circuitBreakers.delete(service);
      logger.info(`Circuit breaker reset for ${service}`);
      this.emit('circuitBreakerReset', service);
      return true;
    }
    
    return false;
  }

  /**
   * Trigger recovery process for a failed service
   */
  private async triggerRecovery(service: 'discord' | 'irc', error: Error): Promise<void> {
    if (this.isRecovering) {
      logger.debug(`Recovery already in progress, skipping trigger for ${service}`);
      return;
    }

    if (!this.isServiceAvailable(service)) {
      logger.debug(`${service} circuit breaker is open, skipping recovery`);
      return;
    }

    this.isRecovering = true;
    this.recoveryPromise = this.executeRecovery(service, error);
    
    try {
      await this.recoveryPromise;
    } finally {
      this.isRecovering = false;
      this.recoveryPromise = undefined;
    }
  }

  /**
   * Execute the recovery process with exponential backoff
   */
  private async executeRecovery(service: 'discord' | 'irc', initialError: Error): Promise<void> {
    logger.info(`Starting recovery process for ${service}`);
    this.emit('recoveryStarted', service, initialError);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const delay = this.calculateDelay(attempt);
      
      const recoveryAttempt: RecoveryAttempt = {
        attempt,
        timestamp: Date.now(),
        delay,
        reason: `${service} connection failure: ${initialError.message}`,
        success: false
      };

      logger.info(`Recovery attempt ${attempt}/${this.config.maxRetries} for ${service} in ${delay}ms`);
      
      // Wait with exponential backoff
      await this.sleep(delay);
      
      try {
        // Emit recovery attempt event for the bot to handle
        const success = await this.attemptRecovery(service);
        
        recoveryAttempt.success = success;
        this.recoveryHistory.push(recoveryAttempt);
        
        if (success) {
          logger.info(`Recovery successful for ${service} on attempt ${attempt}`);
          this.recordSuccess(service);
          this.emit('recoverySucceeded', service, attempt);
          return;
        } else {
          logger.warn(`Recovery attempt ${attempt} failed for ${service}`);
        }
        
      } catch (error) {
        recoveryAttempt.error = error as Error;
        this.recoveryHistory.push(recoveryAttempt);
        
        logger.error(`Recovery attempt ${attempt} failed for ${service}:`, error);
        
        if (attempt === this.config.maxRetries) {
          logger.error(`All recovery attempts exhausted for ${service}`);
          this.emit('recoveryFailed', service, error);
          throw new Error(`Recovery failed for ${service} after ${this.config.maxRetries} attempts`);
        }
      }
    }
  }

  /**
   * Attempt to recover a specific service
   */
  private async attemptRecovery(service: 'discord' | 'irc'): Promise<boolean> {
    return new Promise((resolve) => {
      // Emit event for bot to handle the actual reconnection
      this.emit('attemptReconnection', service, (success: boolean) => {
        resolve(success);
      });
      
      // Timeout after 30 seconds if no response
      setTimeout(() => {
        logger.warn(`Recovery attempt for ${service} timed out`);
        resolve(false);
      }, 30000);
    });
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.config.baseDelay * Math.pow(2, attempt - 1),
      this.config.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.config.jitterRange * (Math.random() * 2 - 1);
    const finalDelay = Math.max(0, exponentialDelay + jitter);
    
    return Math.floor(finalDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start periodic health checking
   */
  private startHealthChecking(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
    
    logger.debug(`Health checking started with ${this.config.healthCheckInterval}ms interval`);
  }

  /**
   * Perform health check on both services
   */
  private performHealthCheck(): void {
    const now = Date.now();
    
    // Check if services have been silent for too long
    const maxSilence = this.config.healthCheckInterval * 3; // 3x the check interval
    
    for (const [service, health] of [['discord', this.discordHealth], ['irc', this.ircHealth]] as const) {
      if (health.isHealthy && now - health.lastSuccessful > maxSilence) {
        logger.warn(`${service} has been silent for ${now - health.lastSuccessful}ms, marking as potentially unhealthy`);
        this.emit('serviceSilent', service, health);
      }
    }
    
    this.emit('healthCheck', {
      discord: this.discordHealth,
      irc: this.ircHealth,
      timestamp: now
    });
  }

  /**
   * Get current health status
   */
  getHealthStatus(): {
    discord: ConnectionHealth;
    irc: ConnectionHealth;
    isRecovering: boolean;
    circuitBreakers: Record<string, number>;
    recoveryHistory: RecoveryAttempt[];
  } {
    return {
      discord: { ...this.discordHealth },
      irc: { ...this.ircHealth },
      isRecovering: this.isRecovering,
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
      recoveryHistory: [...this.recoveryHistory.slice(-10)] // Last 10 attempts
    };
  }

  /**
   * Force a manual recovery attempt
   */
  async forceRecovery(service: 'discord' | 'irc'): Promise<void> {
    if (this.isRecovering) {
      throw new Error('Recovery already in progress');
    }

    logger.info(`Manual recovery triggered for ${service}`);
    await this.triggerRecovery(service, new Error('Manual recovery requested'));
  }

  /**
   * Reset circuit breaker for a service
   */
  resetCircuitBreaker(service: 'discord' | 'irc'): void {
    this.circuitBreakers.delete(service);
    const health = service === 'discord' ? this.discordHealth : this.ircHealth;
    health.consecutiveFailures = 0;
    
    logger.info(`Circuit breaker manually reset for ${service}`);
    this.emit('circuitBreakerReset', service);
  }

  /**
   * Update recovery configuration
   */
  updateConfig(newConfig: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Recovery manager configuration updated:', newConfig);
  }

  /**
   * Get recovery statistics
   */
  getStatistics(): {
    totalRecoveryAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    averageRecoveryTime: number;
    discordHealth: ConnectionHealth;
    ircHealth: ConnectionHealth;
  } {
    const successful = this.recoveryHistory.filter(a => a.success).length;
    const failed = this.recoveryHistory.filter(a => !a.success).length;
    
    const recoveryTimes = this.recoveryHistory
      .filter(a => a.success)
      .map(a => a.delay);
    
    const averageRecoveryTime = recoveryTimes.length > 0 
      ? recoveryTimes.reduce((sum, time) => sum + time, 0) / recoveryTimes.length 
      : 0;

    return {
      totalRecoveryAttempts: this.recoveryHistory.length,
      successfulRecoveries: successful,
      failedRecoveries: failed,
      averageRecoveryTime,
      discordHealth: { ...this.discordHealth },
      ircHealth: { ...this.ircHealth }
    };
  }

  /**
   * Clear recovery history
   */
  clearHistory(): void {
    this.recoveryHistory = [];
    logger.info('Recovery history cleared');
  }

  /**
   * Cleanup when shutting down
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    
    this.removeAllListeners();
    logger.info('Recovery manager destroyed');
  }
}
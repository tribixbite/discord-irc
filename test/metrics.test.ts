import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../lib/metrics';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector(null); // No persistence for testing
  });

  afterEach(() => {
    metrics.destroy();
  });

  it('should initialize with zero metrics', () => {
    const summary = metrics.getSummary();
    expect(summary.totalMessages).toBe(0);
    expect(summary.uniqueUsers).toBe(0);
    expect(summary.errorRate).toBe(0);
  });

  it('should record Discord to IRC messages', () => {
    metrics.recordDiscordToIRC('user123', '#test');
    
    const summary = metrics.getSummary();
    expect(summary.totalMessages).toBe(1);
    expect(summary.uniqueUsers).toBe(1);
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.messagesDiscordToIRC).toBe(1);
    expect(detailed.messagesIRCToDiscord).toBe(0);
  });

  it('should record IRC to Discord messages', () => {
    metrics.recordIRCToDiscord('ircuser', '#test');
    
    const summary = metrics.getSummary();
    expect(summary.totalMessages).toBe(1);
    expect(summary.uniqueUsers).toBe(1);
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.messagesIRCToDiscord).toBe(1);
    expect(detailed.messagesDiscordToIRC).toBe(0);
  });

  it('should track unique users separately for Discord and IRC', () => {
    metrics.recordDiscordToIRC('discord123', '#test');
    metrics.recordIRCToDiscord('ircuser', '#test');
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.uniqueDiscordUsers.size).toBe(1);
    expect(detailed.uniqueIRCUsers.size).toBe(1);
    
    const summary = metrics.getSummary();
    expect(summary.uniqueUsers).toBe(2);
  });

  it('should record various message types', () => {
    metrics.recordCommand();
    metrics.recordAttachment();
    metrics.recordEdit();
    metrics.recordDelete();
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.commandsProcessed).toBe(1);
    expect(detailed.attachmentsSent).toBe(1);
    expect(detailed.editsProcessed).toBe(1);
    expect(detailed.deletesProcessed).toBe(1);
  });

  it('should record rate limiting events', () => {
    metrics.recordMessageBlocked();
    metrics.recordUserWarned();
    metrics.recordUserBlocked();
    metrics.recordSpamDetected();
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.messagesBlocked).toBe(1);
    expect(detailed.usersWarned).toBe(1);
    expect(detailed.usersBlocked).toBe(1);
    expect(detailed.spamDetected).toBe(1);
  });

  it('should track PM events', () => {
    metrics.recordPMThreadCreated();
    metrics.recordPMMessage();
    metrics.recordPMThreadArchived();
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.pmThreadsCreated).toBe(1);
    expect(detailed.pmMessagesExchanged).toBe(1);
    expect(detailed.pmThreadsArchived).toBe(1);
  });

  it('should track errors and connection events', () => {
    metrics.recordError();
    metrics.recordConnectionError();
    metrics.recordWebhookError();
    
    const detailed = metrics.getDetailedMetrics();
    expect(detailed.errorCount).toBe(3); // recordConnectionError and recordWebhookError also call recordError
    expect(detailed.connectionErrors).toBe(1);
    expect(detailed.webhookErrors).toBe(1);
  });

  it('should record latency measurements', () => {
    metrics.recordLatency(100);
    metrics.recordLatency(200);
    metrics.recordLatency(150);
    
    const summary = metrics.getSummary();
    expect(summary.averageLatency).toBe(150); // Average of 100, 200, 150
  });

  it('should track channel activity', () => {
    metrics.recordDiscordToIRC('user1', '#general');
    metrics.recordDiscordToIRC('user2', '#general');
    metrics.recordIRCToDiscord('user3', '#dev');
    
    const summary = metrics.getSummary();
    expect(summary.topChannels).toEqual([
      { channel: '#general', messages: 2 },
      { channel: '#dev', messages: 1 }
    ]);
  });

  it('should track user activity', () => {
    metrics.recordDiscordToIRC('alice', '#test');
    metrics.recordDiscordToIRC('alice', '#test');
    metrics.recordIRCToDiscord('bob', '#test');
    
    const summary = metrics.getSummary();
    expect(summary.topUsers).toEqual([
      { user: 'alice', messages: 2 },
      { user: 'irc:bob', messages: 1 }
    ]);
  });

  it('should calculate error rate correctly', () => {
    // Send 10 messages
    for (let i = 0; i < 10; i++) {
      metrics.recordDiscordToIRC(`user${i}`, '#test');
    }
    
    // Record 2 errors
    metrics.recordError();
    metrics.recordError();
    
    const summary = metrics.getSummary();
    expect(summary.errorRate).toBe(20); // 2 errors out of 10 messages = 20%
  });

  it('should export Prometheus metrics format', () => {
    metrics.recordDiscordToIRC('user', '#test');
    metrics.recordCommand();
    
    const prometheus = metrics.exportPrometheusMetrics();
    
    expect(prometheus).toContain('discord_irc_messages_total{direction="discord_to_irc"} 1');
    expect(prometheus).toContain('discord_irc_commands_total 1');
    expect(prometheus).toContain('discord_irc_users_unique{platform="discord"} 1');
  });

  it('should reset metrics correctly', () => {
    metrics.recordDiscordToIRC('user', '#test');
    metrics.recordCommand();
    
    expect(metrics.getSummary().totalMessages).toBe(1);
    
    metrics.resetMetrics();
    
    const summary = metrics.getSummary();
    expect(summary.totalMessages).toBe(0);
    expect(summary.uniqueUsers).toBe(0);
  });

  it('should track recent activity', () => {
    metrics.recordDiscordToIRC('user', '#test');
    metrics.recordError();
    metrics.recordLatency(100);
    
    const recent = metrics.getRecentActivity();
    expect(recent.messagesLastHour).toBe(1);
    expect(recent.errorsLastHour).toBe(1);
    expect(recent.averageLatencyLastHour).toBe(100);
  });

  it('should calculate uptime correctly', () => {
    // Wait a tiny bit to ensure uptime > 0
    const start = Date.now();
    while (Date.now() - start < 1) { /* wait 1ms */ }
    
    const summary = metrics.getSummary();
    expect(summary.uptime).toBeGreaterThan(0);
    expect(summary.uptime).toBeLessThan(1000); // Should be very small for new instance
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageSynchronizer } from '../lib/message-sync';
import Bot from '../lib/bot';

// Mock bot for testing
const createMockBot = () => {
  return {
    ircClient: {
      say: vi.fn(),
      readyState: 'open'
    },
    parseText: vi.fn().mockReturnValue('test message'),
    persistence: null
  } as any;
};

describe('MessageSynchronizer', () => {
  let messageSync: MessageSynchronizer;
  let mockBot: any;

  beforeEach(() => {
    mockBot = createMockBot();
    messageSync = new MessageSynchronizer(mockBot);
  });

  it('should record messages correctly', () => {
    messageSync.recordMessage('123', '#test', 'Hello world', 'testuser');
    
    const stats = messageSync.getStats();
    expect(stats.trackedMessages).toBe(1);
  });

  it('should provide correct statistics', () => {
    messageSync.recordMessage('123', '#test', 'Hello world', 'testuser');
    messageSync.recordMessage('456', '#test', 'Another message', 'testuser2');
    
    const stats = messageSync.getStats();
    expect(stats.trackedMessages).toBe(2);
    expect(stats.editWindowMinutes).toBe(5); // Default 5 minute window
    expect(stats.oldestMessage).toBeTypeOf('number');
  });

  it('should clear history correctly', () => {
    messageSync.recordMessage('123', '#test', 'Hello world', 'testuser');
    messageSync.recordMessage('456', '#test', 'Another message', 'testuser2');
    
    expect(messageSync.getStats().trackedMessages).toBe(2);
    
    messageSync.clearHistory();
    expect(messageSync.getStats().trackedMessages).toBe(0);
  });

  it('should handle empty history gracefully', () => {
    const stats = messageSync.getStats();
    expect(stats.trackedMessages).toBe(0);
    expect(stats.oldestMessage).toBe(null);
  });
});
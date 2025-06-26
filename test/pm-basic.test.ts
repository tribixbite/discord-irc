import { describe, it, expect } from 'vitest';
import Bot from '../lib/bot';

describe('Private Message Configuration', () => {
  it('should initialize PM configuration with defaults', () => {
    const config = {
      server: 'irc.test.net',
      nickname: 'testbot',
      channelMapping: { '#discord': '#irc' },
      discordToken: 'token',
      privateMessages: {
        channelId: '#private-messages',
        threadPrefix: 'PM: ',
        autoArchive: 60
      }
    };

    const bot = new Bot(config);
    
    expect(bot.pmChannelId).toBe('#private-messages');
    expect(bot.pmThreadPrefix).toBe('PM: ');
    expect(bot.pmAutoArchive).toBe(60);
    expect(bot.pmThreads).toBeInstanceOf(Map);
  });

  it('should handle missing PM configuration gracefully', () => {
    const config = {
      server: 'irc.test.net',
      nickname: 'testbot',
      channelMapping: { '#discord': '#irc' },
      discordToken: 'token'
    };

    const bot = new Bot(config);
    expect(bot.pmChannelId).toBeUndefined();
    expect(bot.pmThreadPrefix).toBe('PM: ');
    expect(bot.pmAutoArchive).toBe(60);
  });

  it('should sanitize nicknames correctly', () => {
    const config = {
      server: 'irc.test.net',
      nickname: 'testbot',
      channelMapping: { '#discord': '#irc' },
      discordToken: 'token'
    };

    const bot = new Bot(config);
    
    expect(bot.sanitizeNickname('test@user')).toBe('test_user');
    expect(bot.sanitizeNickname('user#123')).toBe('user_123');
    expect(bot.sanitizeNickname('nick<script>')).toBe('nick_script_');
    
    // Test length limit
    const longNick = 'a'.repeat(100);
    expect(bot.sanitizeNickname(longNick)).toHaveLength(80);
  });

  it('should update PM thread mapping for nick changes', async () => {
    const config = {
      server: 'irc.test.net',
      nickname: 'testbot',
      channelMapping: { '#discord': '#irc' },
      discordToken: 'token',
      privateMessages: {
        channelId: '#private-messages'
      }
    };

    const bot = new Bot(config);
    
    // Set up a thread mapping
    bot.pmThreads.set('oldnick', 'thread123');
    
    // Mock the PM channel finding to return null (no actual channel)
    bot.findPmChannel = async () => null;
    
    // Update nick change
    await bot.updatePmThreadForNickChange('oldnick', 'newnick');
    
    // Verify mapping was updated
    expect(bot.pmThreads.has('oldnick')).toBe(false);
    expect(bot.pmThreads.get('newnick')).toBe('thread123');
  });
});
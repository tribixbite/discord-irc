import { describe, it, beforeEach, expect } from 'vitest';
import irc from 'irc-upd';
import discord from 'discord.js';
import Bot from '../lib/bot';
import config from './fixtures/single-test-config.json';
import caseConfig from './fixtures/case-sensitivity-config.json';
import DiscordStub from './stubs/discord-stub';
import ClientStub from './stubs/irc-client-stub';
import { validateChannelMapping } from '../lib/validators';

describe('Channel Mapping', () => {
  beforeEach(() => {
    irc.Client = ClientStub;
    discord.Client = DiscordStub as never;
  });

  it('should fail when not given proper JSON', () => {
    const wrongMapping = 'not json';
    function wrap() {
      validateChannelMapping(wrongMapping);
    }

    expect(wrap).toThrow('Invalid channel mapping given');
  });

  it('should not fail if given a proper channel list as JSON', () => {
    const correctMapping = { '#channel': '#otherchannel' };
    function wrap() {
      validateChannelMapping(correctMapping);
    }

    expect(wrap).not.toThrow();
  });

  it('should clear channel keys from the mapping', () => {
    const bot = new Bot(config);
    expect(bot.channelMapping['#discord']).toEqual('#irc');
    expect(bot.invertedMapping['#irc']).toEqual('#discord');
    expect(bot.channels).toContain('#irc channelKey');
  });

  it('should lowercase IRC channel names', () => {
    const bot = new Bot(caseConfig);
    expect(bot.channelMapping['#discord']).toEqual('#irc');
    expect(bot.channelMapping['#otherDiscord']).toEqual('#otherirc');
  });

  it('should work with ID maps', () => {
    const bot = new Bot(config);
    expect(bot.channelMapping['1234']).toEqual('#channelforid');
    expect(bot.invertedMapping['#channelforid']).toEqual('1234');
  });
});

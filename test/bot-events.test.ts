/* eslint-disable @typescript-eslint/unbound-method */
import { afterEach, beforeEach, describe, it, vi, expect } from 'vitest';
import irc from 'irc-upd';
import discord from 'discord.js';
import Bot from '../lib/bot';
import { logger } from '../lib/logger';
import createDiscordStub from './stubs/discord-stub';
import createWebhookStub from './stubs/webhook-stub';
import ClientStub from './stubs/irc-client-stub';
import config from './fixtures/single-test-config.json';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Bot Events', () => {
  const createBot = (optConfig: Record<string, unknown> | null = null) => {
    const useConfig = optConfig || config;
    const bot = new Bot(useConfig);
    bot.sendToIRC = vi.fn();
    bot.sendToDiscord = vi.fn();
    bot.sendExactToDiscord = vi.fn();
    return bot;
  };

  let sendStub;
  let bot;

  beforeEach(async () => {
    sendStub = vi.fn();
    irc.Client = ClientStub;
    discord.Client = createDiscordStub(sendStub) as never;
    discord.WebhookClient = createWebhookStub(sendStub) as never;
    ClientStub.prototype.send = vi.fn();
    ClientStub.prototype.join = vi.fn();
    bot = createBot();
    await bot.connect();
  });

  afterEach(function () {
    bot.disconnect();
    vi.restoreAllMocks();
  });

  it('should log on discord ready event', () => {
    bot.discord.emit('ready');
    expect(logger.info).toHaveBeenCalledWith('Connected to Discord');
  });

  it('should log on irc registered event', () => {
    const message = 'registered';
    bot.ircClient.emit('registered', message);
    expect(logger.info).toHaveBeenCalledWith('Connected to IRC');
    expect(logger.debug).toHaveBeenCalledWith('Registered event: ', message);
  });

  it('should try to send autoSendCommands on registered IRC event', () => {
    bot.ircClient.emit('registered');
    expect(ClientStub.prototype.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ClientStub.prototype.send).mock.calls[0]).toEqual(
      config.autoSendCommands[0],
    );
    expect(vi.mocked(ClientStub.prototype.send).mock.calls[1]).toEqual(
      config.autoSendCommands[1],
    );
  });

  it('should error log on error events', () => {
    const discordError = new Error('discord');
    const ircError = new Error('irc');
    bot.discord.emit('error', discordError);
    bot.ircClient.emit('error', ircError);
    const mock = vi.mocked(logger.error).mock;
    expect(mock.calls[0][0]).toEqual('Received error event from Discord');
    // @ts-expect-error potentially invalid overloads on logger
    expect(mock.calls[0][1]).toEqual(discordError);
    expect(mock.calls[1][0]).toEqual('Received error event from IRC');
    // @ts-expect-error potentially invalid overloads on logger
    expect(mock.calls[1][1]).toEqual(ircError);
  });

  it('should warn log on warn events from discord', () => {
    const discordError = new Error('discord');
    bot.discord.emit('warn', discordError);
    // @ts-expect-error potentially invalid overloads on logger
    const [message, error] = vi.mocked(logger.warn).mock.calls[0];
    expect(message).toEqual('Received warn event from Discord');
    expect(error).toEqual(discordError);
  });

  it('should send messages to irc if correct', () => {
    const message = {
      type: 'message',
    };

    bot.discord.emit('message', message);
    expect(bot.sendToIRC).toHaveBeenCalledWith(message);
  });

  it('should send messages to discord', () => {
    const channel = '#channel';
    const author = 'user';
    const text = 'hi';
    bot.ircClient.emit('message', author, channel, text);
    expect(bot.sendToDiscord).toHaveBeenCalledWith(author, channel, text);
  });

  it('should send notices to discord', () => {
    const channel = '#channel';
    const author = 'user';
    const text = 'hi';
    const formattedText = `*${text}*`;
    bot.ircClient.emit('notice', author, channel, text);
    expect(bot.sendToDiscord).toHaveBeenCalledWith(
      author,
      channel,
      formattedText,
    );
  });

  it('should not send name change event to discord', () => {
    const channel = '#channel';
    const oldnick = 'user1';
    const newnick = 'user2';
    bot.ircClient.emit('nick', oldnick, newnick, [channel]);
    expect(bot.sendExactToDiscord).not.toHaveBeenCalled();
  });

  it('should send name change event to discord', async function () {
    const channel1 = '#channel1';
    const channel2 = '#channel2';
    const channel3 = '#channel3';
    const oldNick = 'user1';
    const newNick = 'user2';
    const user3 = 'user3';
    const bot = createBot({ ...config, ircStatusNotices: true });
    const staticChannel = new Set([bot.nickname, user3]);
    await bot.connect();
    bot.ircClient.emit('names', channel1, {
      [bot.nickname]: '',
      [oldNick]: '',
    });
    bot.ircClient.emit('names', channel2, { [bot.nickname]: '', [user3]: '' });
    const channelNicksPre = new Set([bot.nickname, oldNick]);
    expect(bot.channelUsers).toEqual({
      '#channel1': channelNicksPre,
      '#channel2': staticChannel,
    });
    const formattedText = `*${oldNick}* is now known as ${newNick}`;
    const channelNicksAfter = new Set([bot.nickname, newNick]);
    bot.ircClient.emit('nick', oldNick, newNick, [
      channel1,
      channel2,
      channel3,
    ]);
    expect(bot.sendExactToDiscord).toHaveBeenCalledWith(
      channel1,
      formattedText,
    );
    expect(bot.channelUsers).toEqual({
      '#channel1': channelNicksAfter,
      '#channel2': staticChannel,
    });
  });

  it('should send actions to discord', () => {
    const channel = '#channel';
    const author = 'user';
    const text = 'hi';
    const formattedText = '_hi_';
    const message = {};
    bot.ircClient.emit('action', author, channel, text, message);
    expect(bot.sendToDiscord).toHaveBeenCalledWith(
      author,
      channel,
      formattedText,
    );
  });

  it('should keep track of users through names event when irc status notices enabled', async function () {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    expect(typeof bot.channelUsers).toBe('object');
    const channel = '#channel';
    // nick => '' means the user is not a special user
    const nicks = {
      [bot.nickname]: '',
      user: '',
      user2: '@',
      user3: '+',
    };
    bot.ircClient.emit('names', channel, nicks);
    const channelNicks = new Set([bot.nickname, 'user', 'user2', 'user3']);
    expect(bot.channelUsers).toEqual({ '#channel': channelNicks });
  });

  it('should lowercase the channelUsers mapping', async () => {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channelName';
    const nicks = { [bot.nickname]: '' };
    bot.ircClient.emit('names', channel, nicks);
    const channelNicks = new Set([bot.nickname]);
    expect(bot.channelUsers).toEqual({ '#channelname': channelNicks });
  });

  it('should send join messages to discord when config enabled', async function () {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channel';
    bot.ircClient.emit('names', channel, { [bot.nickname]: '' });
    const nick = 'user';
    const text = `*${nick}* has joined the channel`;
    bot.ircClient.emit('join', channel, nick);
    expect(bot.sendExactToDiscord).toHaveBeenCalledWith(channel, text);
    const channelNicks = new Set([bot.nickname, nick]);
    expect(bot.channelUsers).toEqual({ '#channel': channelNicks });
  });

  it('should not announce itself joining by default', async () => {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channel';
    bot.ircClient.emit('names', channel, { [bot.nickname]: '' });
    const nick = bot.nickname;
    bot.ircClient.emit('join', channel, nick);
    expect(bot.sendExactToDiscord).not.toHaveBeenCalled();
    const channelNicks = new Set([bot.nickname]);
    expect(bot.channelUsers).toEqual({ '#channel': channelNicks });
  });

  it('should announce the bot itself when config enabled', async () => {
    // self-join is announced before names (which includes own nick)
    // hence don't trigger a names and don't expect anything of bot.channelUsers
    const bot = createBot({
      ...config,
      ircStatusNotices: true,
      announceSelfJoin: true,
    });
    await bot.connect();
    const channel = '#channel';
    const nick = bot.nickname;
    const text = `*${nick}* has joined the channel`;
    bot.ircClient.emit('join', channel, nick);
    expect(bot.sendExactToDiscord).toHaveBeenCalledWith(channel, text);
  });

  it('should send part messages to discord when config enabled', async function () {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channel';
    const nick = 'user';
    bot.ircClient.emit('names', channel, { [bot.nickname]: '', [nick]: '' });
    const originalNicks = new Set([bot.nickname, nick]);
    expect(bot.channelUsers).toEqual({ '#channel': originalNicks });
    const reason = 'Leaving';
    const text = `*${nick}* has left the channel (${reason})`;
    bot.ircClient.emit('part', channel, nick, reason);
    expect(bot.sendExactToDiscord).toHaveBeenCalledWith(channel, text);
    // it should remove the nickname from the channelUsers list
    const channelNicks = new Set([bot.nickname]);
    expect(bot.channelUsers).toEqual({ '#channel': channelNicks });
  });

  it('should not announce itself leaving a channel', async function () {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channel';
    bot.ircClient.emit('names', channel, { [bot.nickname]: '', user: '' });
    const originalNicks = new Set([bot.nickname, 'user']);
    expect(bot.channelUsers).toEqual({ '#channel': originalNicks });
    const reason = 'Leaving';
    bot.ircClient.emit('part', channel, bot.nickname, reason);
    expect(bot.sendExactToDiscord).not.toHaveBeenCalled();
    // it should remove the nickname from the channelUsers list
    expect(bot.channelUsers).toEqual({});
  });

  it('should only send quit messages to discord for channels the user is tracked in', async function () {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel1 = '#channel1';
    const channel2 = '#channel2';
    const channel3 = '#channel3';
    const nick = 'user';
    bot.ircClient.emit('names', channel1, { [bot.nickname]: '', [nick]: '' });
    bot.ircClient.emit('names', channel2, { [bot.nickname]: '' });
    bot.ircClient.emit('names', channel3, { [bot.nickname]: '', [nick]: '' });
    const reason = 'Quit: Leaving';
    const text = `*${nick}* has quit (${reason})`;
    // send quit message for all channels on server, as the node-irc library does
    bot.ircClient.emit('quit', nick, reason, [channel1, channel2, channel3]);
    expect(bot.sendExactToDiscord).toHaveBeenCalledTimes(2);
    const mock = vi.mocked(bot.sendExactToDiscord).mock;
    expect(mock.calls[0]).toEqual([channel1, text]);
    expect(mock.calls[1]).toEqual([channel3, text]);
  });

  it('should not crash with join/part/quit messages and weird channel casing', async () => {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();

    function wrap() {
      const nick = 'user';
      const reason = 'Leaving';
      bot.ircClient.emit('names', '#Channel', { [bot.nickname]: '' });
      bot.ircClient.emit('join', '#cHannel', nick);
      bot.ircClient.emit('part', '#chAnnel', nick, reason);
      bot.ircClient.emit('join', '#chaNnel', nick);
      bot.ircClient.emit('quit', nick, reason, ['#chanNel']);
    }
    expect(wrap).not.toThrow();
  });

  it('should be possible to disable join/part/quit messages', async () => {
    const bot = createBot({ ...config, ircStatusNotices: false });
    await bot.connect();
    const channel = '#channel';
    const nick = 'user';
    const reason = 'Leaving';

    bot.ircClient.emit('names', channel, { [bot.nickname]: '' });
    bot.ircClient.emit('join', channel, nick);
    bot.ircClient.emit('part', channel, nick, reason);
    bot.ircClient.emit('join', channel, nick);
    bot.ircClient.emit('quit', nick, reason, [channel]);
    expect(bot.sendExactToDiscord).not.toHaveBeenCalled();
  });

  it('should warn if it receives a part/quit before a names event', async () => {
    const bot = createBot({ ...config, ircStatusNotices: true });
    await bot.connect();
    const channel = '#channel';
    const reason = 'Leaving';

    bot.ircClient.emit('part', channel, 'user1', reason);
    bot.ircClient.emit('quit', 'user2', reason, [channel]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    const mock = vi.mocked(logger.warn).mock;
    expect(mock.calls[0]).toEqual([
      `No channelUsers found for ${channel} when user1 parted.`,
    ]);
    expect(mock.calls[1]).toEqual([
      `No channelUsers found for ${channel} when user2 quit, ignoring.`,
    ]);
  });

  it('should not crash if it uses a different name from config', async () => {
    // this can happen when a user with the same name is already connected
    const bot = createBot({ ...config, nickname: 'testbot' });
    await bot.connect();
    const newName = 'testbot1';
    bot.ircClient.nick = newName;
    function wrap() {
      bot.ircClient.emit('join', '#channel', newName);
    }
    expect(wrap).not.toThrow();
  });

  it('should not listen to discord debug messages in production', async () => {
    logger.level = 'info';
    const bot = createBot();
    await bot.connect();
    const listeners = bot.discord.listeners('debug');
    expect(listeners.length).toEqual(0);
  });

  it('should listen to discord debug messages in development', async () => {
    logger.level = 'debug';
    const bot = createBot();
    await bot.connect();
    const listeners = bot.discord.listeners('debug');
    expect(listeners.length).toEqual(1);
  });

  const mock = vi.mocked(logger.debug).mock;
  it('should join channels when invited', () => {
    const channel = '#irc';
    const author = 'user';
    bot.ircClient.emit('invite', channel, author);
    const firstCall = mock.calls[1];
    expect(firstCall[0]).toEqual('Received invite:');
    // @ts-expect-error potentially invalid overloads on logger
    expect(firstCall[1]).toEqual(channel);
    // @ts-expect-error potentially invalid overloads on logger
    expect(firstCall[2]).toEqual(author);

    expect(ClientStub.prototype.join).toHaveBeenCalledWith(channel);
    const secondCall = mock.calls[2];
    expect(secondCall[0]).toEqual('Joining channel:');
    // @ts-expect-error potentially invalid overloads on logger
    expect(secondCall[1]).toEqual(channel);
  });

  it("should not join channels that aren't in the channel mapping", function () {
    const channel = '#wrong';
    const author = 'user';
    bot.ircClient.emit('invite', channel, author);
    const firstCall = mock.calls[1];
    expect(firstCall[0]).toEqual('Received invite:');
    // @ts-expect-error potentially invalid overloads on logger
    expect(firstCall[1]).toEqual(channel);
    // @ts-expect-error potentially invalid overloads on logger
    expect(firstCall[2]).toEqual(author);

    expect(ClientStub.prototype.join).not.toHaveBeenCalled();
    const secondCall = mock.calls[2];
    expect(secondCall[0]).toEqual('Channel not found in config, not joining:');
    // @ts-expect-error potentially invalid overloads on logger
    expect(secondCall[1]).toEqual(channel);
  });
});

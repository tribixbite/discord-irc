/* eslint-disable @typescript-eslint/require-await */

import { it, afterEach, beforeEach, describe, expect, vi } from 'vitest';
import irc from 'irc-upd';
import discord from 'discord.js';
import Bot from '../lib/bot';
import createDiscordStub from './stubs/discord-stub';
import ClientStub from './stubs/irc-client-stub';
import createWebhookStub from './stubs/webhook-stub';
import config from './fixtures/single-test-config.json';
import configMsgFormatDefault from './fixtures/msg-formats-default.json';
import { logger } from '../lib/logger';

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Bot', async () => {
  let sendStub;
  let sendWebhookMessageStub;

  let bot: Bot;
  let guild;

  const setCustomBot = async (conf) => {
    bot = new Bot(conf);
    guild = bot.discord.guilds.cache.first();
    await bot.connect();
  };

  // modified variants of https://github.com/discordjs/discord.js/blob/stable/src/client/ClientDataManager.js
  // (for easier stubbing)
  const addUser = function (user, member: unknown = null) {
    // @ts-expect-error private but only at compile time
    const userObj = new discord.User(bot.discord, user);
    // also set guild members
    const guildMember = { ...(member || user), user: userObj };
    guildMember.nick = guildMember.nickname; // nick => nickname in Discord API
    // @ts-expect-error private but only at compile time
    const memberObj = new discord.GuildMember(bot.discord, guildMember, guild);
    guild.members.cache.set(userObj.id, memberObj);
    bot.discord.users.cache.set(userObj.id, userObj);
    return memberObj;
  };

  const addRole = function (role) {
    // @ts-expect-error private but only at compile time
    const roleObj = new discord.Role(bot.discord, role, guild);
    guild.roles.cache.set(roleObj.id, roleObj);
    return roleObj;
  };

  const addEmoji = function (emoji) {
    // @ts-expect-error private but only at compile time
    const emojiObj = new discord.GuildEmoji(bot.discord, emoji, guild);
    guild.emojis.cache.set(emojiObj.id, emojiObj);
    return emojiObj;
  };

  let sayMock;

  beforeEach(async () => {
    sendStub = vi.fn();

    irc.Client = ClientStub;
    discord.Client = createDiscordStub(sendStub) as never;

    sayMock = vi.fn();
    ClientStub.prototype.say = sayMock;
    ClientStub.prototype.send = vi.fn();
    ClientStub.prototype.join = vi.fn();
    sendWebhookMessageStub = vi.fn();
    discord.WebhookClient = createWebhookStub(sendWebhookMessageStub) as never;

    await setCustomBot(config);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  const createAttachments = (url) => {
    const attachments = new discord.Collection();
    attachments.set(1, { url });
    return attachments;
  };

  it('should invert the channel mapping', async () => {
    expect(bot.invertedMapping['#irc']).toEqual('#discord');
  });

  it('should send correctly formatted messages to discord', async () => {
    const username = 'testuser';
    const text = 'test message';
    const formatted = `**<${username}>** ${text}`;
    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(formatted);
  });

  it('should lowercase channel names before sending to discord', async () => {
    const username = 'testuser';
    const text = 'test message';
    const formatted = `**<${username}>** ${text}`;
    await bot.sendToDiscord(username, '#IRC', text);
    expect(sendStub).toHaveBeenCalledWith(formatted);
  });

  it("should not send messages to discord if the channel isn't in the channel mapping", async () => {
    await bot.sendToDiscord('user', '#no-irc', 'message');
    expect(sendStub).not.toHaveBeenCalled();
  });

  it("should not send messages to discord if it isn't in the channel", async () => {
    await bot.sendToDiscord('user', '#otherirc', 'message');
    expect(sendStub).not.toHaveBeenCalled();
  });

  it('should send to a discord channel ID appropriately', async () => {
    const username = 'testuser';
    const text = 'test message';
    const formatted = `**<${username}>** ${text}`;
    await bot.sendToDiscord(username, '#channelforid', text);
    expect(sendStub).toHaveBeenCalledWith(formatted);
  });

  it("should not send special messages to discord if the channel isn't in the channel mapping", async () => {
    await bot.sendExactToDiscord('#no-irc', 'message');
    expect(sendStub).not.toHaveBeenCalled();
  });

  it("should not send special messages to discord if it isn't in the channel", async () => {
    await bot.sendExactToDiscord('#otherirc', 'message');
    expect(sendStub).not.toHaveBeenCalled();
  });

  it('should send special messages to discord', async () => {
    await bot.sendExactToDiscord('#irc', 'message');
    expect(sendStub).toHaveBeenCalledWith('message');
    expect(logger.debug).toHaveBeenCalledWith(
      'Sending special message to Discord',
      'message',
      '#irc',
      '->',
      '#discord',
    );
  });

  it('should not color irc messages if the option is disabled', async () => {
    const text = 'testmessage';
    const newConfig = { ...config, ircNickColor: false };
    await setCustomBot(newConfig);
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    const expected = `<${message.author.username}> ${text}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should only use message color defined in config', async () => {
    const text = 'testmessage';
    const newConfig = { ...config, ircNickColors: ['orange'] };
    await setCustomBot(newConfig);
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    const expected = `<\u000307${message.author.username}\u000f> ${text}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should send correct messages to irc', async () => {
    const text = 'testmessage';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    // Wrap in colors:
    const expected = `<\u000304${message.author.username}\u000f> ${text}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should send to IRC channel mapped by discord channel ID if available', async () => {
    const text = 'test message';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        id: 1234,
        name: 'namenotinmapping',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    // Wrap it in colors:
    const expected = `<\u000312${message.author.username}\u000f> test message`;
    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledWith('#channelforid', expected);
  });

  it('should send to IRC channel mapped by discord channel name if ID not available', async () => {
    const text = 'test message';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        id: 1235,
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    // Wrap it in colors:
    const expected = `<\u000312${message.author.username}\u000f> test message`;
    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should send attachment URL to IRC', async () => {
    const attachmentUrl = 'https://image/url.jpg';
    const message = {
      content: '',
      mentions: { users: [] },
      attachments: createAttachments(attachmentUrl),
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    const expected = `<\u000304${message.author.username}\u000f> ${attachmentUrl}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should send text message and attachment URL to IRC if both exist', async () => {
    const text = 'Look at this cute cat picture!';
    const attachmentUrl = 'https://image/url.jpg';
    const message = {
      content: text,
      attachments: createAttachments(attachmentUrl),
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);

    expect(sayMock).toHaveBeenCalledWith(
      '#irc',
      `<\u000304${message.author.username}\u000f> ${text}`,
    );

    const expected = `<\u000304${message.author.username}\u000f> ${attachmentUrl}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should not send an empty text message with an attachment to IRC', async () => {
    const message = {
      content: '',
      attachments: createAttachments('https://image/url.jpg'),
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);

    expect(sayMock).toHaveBeenCalledOnce();
  });

  it('should not send its own messages to irc', async () => {
    const message = {
      author: {
        username: 'bot',
        id: bot.discord.user!.id,
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock).not.toHaveBeenCalled();
  });

  it("should not send messages to irc if the channel isn't in the channel mapping", async () => {
    const message = {
      channel: {
        name: 'wrongdiscord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock).not.toHaveBeenCalled();
  });

  it('should break mentions when parallelPingFix is enabled', async () => {
    const newConfig = { ...config, parallelPingFix: true };
    await setCustomBot(newConfig);

    const text = 'testmessage';
    const username = 'otherauthor';
    const brokenNickname = 'o\u200Btherauthor';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username,
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    // Wrap in colors:
    const expected = `<\u000304${brokenNickname}\u000f> ${text}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should parse text from discord when sending messages', async () => {
    const text = '<#1234>';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    // Wrap it in colors:
    const expected = `<\u000312${message.author.username}\u000f> #${message.channel.name}`;
    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should use #deleted-channel when referenced channel fails to exist', async () => {
    const text = '<#1235>';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    // Discord displays "#deleted-channel" if channel doesn't exist (e.g. <#1235>)
    // Wrap it in colors:
    const expected = `<\u000312${message.author.username}\u000f> #deleted-channel`;
    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should convert user mentions from discord', async () => {
    const message = {
      mentions: {
        users: [
          {
            id: 123,
            username: 'testuser',
          },
        ],
      },
      content: '<@123> hi',
      guild: guild,
    };

    expect(bot.parseText(message)).toEqual('@testuser hi');
  });

  it('should convert user nickname mentions from discord', async () => {
    const message = {
      mentions: {
        users: [
          {
            id: 123,
            username: 'testuser',
          },
        ],
      },
      content: '<@!123> hi',
      guild: guild,
    };

    expect(bot.parseText(message)).toEqual('@testuser hi');
  });

  it('should convert twitch emotes from discord', async () => {
    const message = {
      mentions: { users: [] },
      content: '<:SCGWat:230473833046343680>',
    };

    expect(bot.parseText(message)).toEqual(':SCGWat:');
  });

  it('should convert animated emoji from discord', async () => {
    const message = {
      mentions: { users: [] },
      content: '<a:in_love:432887860270465028>',
    };

    expect(bot.parseText(message)).toEqual(':in_love:');
  });

  it.skip('should convert user at-mentions from IRC', async () => {
    const testUser = addUser({ username: 'testuser', id: '123' });

    const username = 'ircuser';
    const text = 'Hello, @testuser!';
    const expected = `**<${username}>** Hello, <@${testUser.id}>!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it.skip('should convert user colon-initial mentions from IRC', async () => {
    const testUser = addUser({ username: 'testuser', id: '123' });

    const username = 'ircuser';
    const text = 'testuser: hello!';
    const expected = `**<${username}>** <@${testUser.id}> hello!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it.skip('should convert user comma-initial mentions from IRC', async () => {
    const testUser = addUser({ username: 'testuser', id: '123' });

    const username = 'ircuser';
    const text = 'testuser, hello!';
    const expected = `**<${username}>** <@${testUser.id}> hello!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it('should not convert user initial mentions from IRC mid-message', async () => {
    addUser({ username: 'testuser', id: '123' });

    const username = 'ircuser';
    const text = 'Hi there testuser, how goes?';
    const expected = `**<${username}>** Hi there testuser, how goes?`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should not convert user at-mentions from IRC if such user does not exist', async () => {
    const username = 'ircuser';
    const text = 'See you there @5pm';
    const expected = `**<${username}>** See you there @5pm`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should not convert user initial mentions from IRC if such user does not exist', async () => {
    const username = 'ircuser';
    const text = 'Agreed, see you then.';
    const expected = `**<${username}>** Agreed, see you then.`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it.skip('should convert multiple user mentions from IRC', async () => {
    const testUser = addUser({ username: 'testuser', id: '123' });
    const anotherUser = addUser({ username: 'anotheruser', id: '124' });

    const username = 'ircuser';
    const text =
      'Hello, @testuser and @anotheruser, was our meeting scheduled @5pm?';
    const expected =
      `**<${username}>** Hello, <@${testUser.id}> and <@${anotherUser.id}>,` +
      ' was our meeting scheduled @5pm?';

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should convert emoji mentions from IRC', async () => {
    addEmoji({ id: '987', name: 'testemoji', require_colons: true });

    const username = 'ircuser';
    const text =
      "Here is a broken :emojitest:, a working :testemoji: and another :emoji: that won't parse";
    const expected = `**<${username}>** Here is a broken :emojitest:, a working <:testemoji:987> and another :emoji: that won't parse`;
    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should convert channel mentions from IRC', async () => {
    guild.addTextChannel({ id: '1235', name: 'testchannel' });
    guild.addTextChannel({ id: '1236', name: 'channel-compliqué' });
    // @ts-expect-error confusion between stub and real at types
    const otherGuild = bot.discord.createGuildStub({ id: '2' });
    otherGuild.addTextChannel({ id: '1237', name: 'foreignchannel' });

    const username = 'ircuser';
    const text =
      "Here is a broken #channelname, a working #testchannel, #channel-compliqué, an irregular case #TestChannel and another guild's #foreignchannel";
    const expected = `**<${username}>** Here is a broken #channelname, a working <#1235>, <#1236>, an irregular case <#1235> and another guild's #foreignchannel`;
    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it.skip('should convert newlines from discord', async () => {
    const message = {
      mentions: { users: [] },
      content: 'hi\nhi\r\nhi\r',
    };

    expect(bot.parseText(message)).toEqual('hi hi hi ');
  });

  it('should hide usernames for commands to IRC', async () => {
    const text = '!test command';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock.mock.calls[0]).toEqual([
      '#irc',
      'Command sent from Discord by test:',
    ]);
    expect(sayMock.mock.calls[1]).toEqual(['#irc', text]);
  });

  it('should support multi-character command prefixes', async () => {
    await setCustomBot({ ...config, commandCharacters: ['@@'] });
    const text = '@@test command';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock.mock.calls[0]).toEqual([
      '#irc',
      'Command sent from Discord by test:',
    ]);
    expect(sayMock.mock.calls[1]).toEqual(['#irc', text]);
  });

  it('should hide usernames for commands to Discord', async () => {
    const username = 'ircuser';
    const text = '!command';

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub.mock.calls[0]).toEqual([
      'Command sent from IRC by ircuser:',
    ]);
    expect(sendStub.mock.calls[1]).toEqual([text]);
  });

  it('should use nickname instead of username when available', async () => {
    const text = 'testmessage';
    const newConfig = { ...config, ircNickColor: false };
    await setCustomBot(newConfig);
    const id = 'not bot id';
    const nickname = 'discord-nickname';
    guild.members.cache.set(id, { nickname });
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id,
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    const expected = `<${nickname}> ${text}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it.skip('should convert user nickname mentions from IRC', async () => {
    const testUser = addUser({
      username: 'testuser',
      id: '123',
      nickname: 'somenickname',
    });

    const username = 'ircuser';
    const text = 'Hello, @somenickname!';
    const expected = `**<${username}>** Hello, ${testUser}!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it.skip('should convert username mentions from IRC even if nickname differs', async () => {
    const testUser = addUser({
      username: 'testuser',
      id: '123',
      nickname: 'somenickname',
    });

    const username = 'ircuser';
    const text = 'Hello, @testuser!';
    const expected = `**<${username}>** Hello, ${testUser}!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it('should convert username-discriminator mentions from IRC properly', async () => {
    const user1 = addUser({
      username: 'user',
      id: '123',
      discriminator: '9876',
    });
    const user2 = addUser({
      username: 'user',
      id: '124',
      discriminator: '5555',
      nickname: 'secondUser',
    });

    const username = 'ircuser';
    const text = 'hello @user#9876 and @user#5555 and @fakeuser#1234';
    const expected = `**<${username}>** hello ${user1} and ${user2} and @fakeuser#1234`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should convert role mentions from discord', async () => {
    addRole({ name: 'example-role', id: '12345' });
    const text = '<@&12345>';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    expect(bot.parseText(message)).toEqual('@example-role');
  });

  it('should use @deleted-role when referenced role fails to exist', async () => {
    addRole({ name: 'example-role', id: '12345' });

    const text = '<@&12346>';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'test',
        id: 'not bot id',
      },
      guild: guild,
    };

    // Discord displays "@deleted-role" if role doesn't exist (e.g. <@&12346>)
    expect(bot.parseText(message)).toEqual('@deleted-role');
  });

  it.skip('should convert role mentions from IRC if role mentionable', async () => {
    const testRole = addRole({
      name: 'example-role',
      id: '12345',
      mentionable: true,
    });

    const username = 'ircuser';
    const text = 'Hello, @example-role!';
    const expected = `**<${username}>** Hello, <@&${testRole.id}>!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it('should not convert role mentions from IRC if role not mentionable', async () => {
    addRole({ name: 'example-role', id: '12345', mentionable: false });

    const username = 'ircuser';
    const text = 'Hello, @example-role!';
    const expected = `**<${username}>** Hello, @example-role!`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it.skip('should convert overlapping mentions from IRC properly and case-insensitively', async () => {
    const user = addUser({ username: 'user', id: '111' });
    const nickUser = addUser({
      username: 'user2',
      id: '112',
      nickname: 'userTest',
    });
    const nickUserCase = addUser({
      username: 'user3',
      id: '113',
      nickname: 'userTEST',
    });
    const role = addRole({
      name: 'userTestRole',
      id: '12345',
      mentionable: true,
    });

    const username = 'ircuser';
    const text =
      'hello @User, @user, @userTest, @userTEST, @userTestRole and @usertestrole';
    const expected = `**<${username}>** hello ${user}, ${user}, ${nickUser}, ${nickUserCase}, ${role} and ${role}`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it.skip('should convert partial matches from IRC properly', async () => {
    const user = addUser({ username: 'user', id: '111' });
    const longUser = addUser({ username: 'user-punc', id: '112' });
    const nickUser = addUser({
      username: 'user2',
      id: '113',
      nickname: 'nick',
    });
    const nickUserCase = addUser({
      username: 'user3',
      id: '114',
      nickname: 'NiCK',
    });
    const role = addRole({ name: 'role', id: '12345', mentionable: true });

    const username = 'ircuser';
    const text =
      "@user-ific @usermore, @user's friend @user-punc, @nicks and @NiCKs @roles";
    const expected = `**<${username}>** ${user}-ific ${user}more, ${user}'s friend ${longUser}, ${nickUser}s and ${nickUserCase}s ${role}s`;

    await bot.sendToDiscord(username, '#irc', text);
    expect(sendStub).not.toHaveBeenCalledWith(expected);
  });

  it('should successfully send messages with default config', async () => {
    await setCustomBot(configMsgFormatDefault);

    await bot.sendToDiscord('testuser', '#irc', 'test message');
    expect(sendStub).toHaveBeenCalledTimes(1);
    const message = {
      content: 'test message',
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sendStub).toHaveBeenCalledTimes(1);
  });

  it('should not replace unmatched patterns', async () => {
    const format = {
      discord: '{$unmatchedPattern} stays intact: {$author} {$text}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const username = 'testuser';
    const msg = 'test message';
    const expected = `{$unmatchedPattern} stays intact: ${username} ${msg}`;
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should respect custom formatting for Discord', async () => {
    const format = {
      discord: '<{$author}> {$ircChannel} => {$discordChannel}: {$text}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const username = 'test';
    const msg = 'test @user <#1234>';
    const expected = `<test> #irc => #discord: ${msg}`;
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should successfully send messages with default config 2', async () => {
    await setCustomBot(configMsgFormatDefault);

    await bot.sendToDiscord('testuser', '#irc', 'test message');
    expect(sendStub).toHaveBeenCalledTimes(1);
    const message = {
      content: 'test message',
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sendStub).toHaveBeenCalledTimes(1);
  });

  it('should not replace unmatched patterns 2', async () => {
    const format = {
      discord: '{$unmatchedPattern} stays intact: {$author} {$text}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const username = 'testuser';
    const msg = 'test message';
    const expected = `{$unmatchedPattern} stays intact: ${username} ${msg}`;
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should respect custom formatting for regular Discord output', async () => {
    const format = {
      discord: '<{$author}> {$ircChannel} => {$discordChannel}: {$text}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const username = 'test';
    const msg = 'test @user <#1234>';
    const expected = `<test> #irc => #discord: ${msg}`;
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub).toHaveBeenCalledWith(expected);
  });

  it('should respect custom formatting for commands in Discord output', async () => {
    const format = {
      commandPrelude:
        '{$nickname} from {$ircChannel} sent command to {$discordChannel}:',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const username = 'test';
    const msg = '!testcmd';
    const expected = 'test from #irc sent command to #discord:';
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub.mock.calls[0]).toEqual([expected]);
    expect(sendStub.mock.calls[1]).toEqual([msg]);
  });

  it('should respect custom formatting for regular IRC output', async () => {
    const format = {
      ircText: '<{$nickname}> {$discordChannel} => {$ircChannel}: {$text}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });
    const message = {
      content: 'test message',
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'testauthor',
        id: 'not bot id',
      },
      guild: guild,
    };
    const expected = '<testauthor> #discord => #irc: test message';

    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should respect custom formatting for commands in IRC output', async () => {
    const format = {
      commandPrelude:
        '{$nickname} from {$discordChannel} sent command to {$ircChannel}:',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const text = '!testcmd';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'testauthor',
        id: 'not bot id',
      },
      guild: guild,
    };
    const expected = 'testauthor from #discord sent command to #irc:';

    bot.sendToIRC(message);
    expect(sayMock.mock.calls[0]).toEqual(['#irc', expected]);
    expect(sayMock.mock.calls[1]).toEqual(['#irc', text]);
  });

  it('should respect custom formatting for attachment URLs in IRC output', async () => {
    const format = {
      urlAttachment:
        '<{$nickname}> {$discordChannel} => {$ircChannel}, attachment: {$attachmentURL}',
    };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const attachmentUrl = 'https://image/url.jpg';
    const message = {
      content: '',
      mentions: { users: [] },
      attachments: createAttachments(attachmentUrl),
      channel: {
        name: 'discord',
      },
      author: {
        username: 'otherauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    const expected = `<otherauthor> #discord => #irc, attachment: ${attachmentUrl}`;
    expect(sayMock).toHaveBeenCalledWith('#irc', expected);
  });

  it('should not bother with command prelude if falsy', async () => {
    const format = { commandPrelude: null };
    await setCustomBot({ ...configMsgFormatDefault, format });

    const text = '!testcmd';
    const message = {
      content: text,
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'testauthor',
        id: 'not bot id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock).toHaveBeenCalledOnce();
    expect(sayMock.mock.calls[0]).toEqual(['#irc', text]);

    const username = 'test';
    const msg = '!testcmd';
    await bot.sendToDiscord(username, '#irc', msg);
    expect(sendStub).toHaveBeenCalledTimes(1);
    expect(sendStub.mock.calls[0]).toEqual([msg]);
  });

  it('should create webhooks clients for each webhook url in the config', async () => {
    expect(bot.webhooks).toHaveProperty('#withwebhook');
  });

  it('should extract id and token from webhook urls', async () => {
    expect(bot.webhooks['#withwebhook'].id).toEqual('id');
  });

  it('should find the matching webhook when it exists', async () => {
    expect(bot.findWebhook('#ircwebhook')).not.toEqual(null);
  });

  describe('with enabled Discord webhook', async () => {
    beforeEach(async () => {
      const newConfig = {
        ...config,
        webhooks: { '#discord': 'https://discord.com/api/webhooks/id/token' },
      };
      await setCustomBot(newConfig);
    });

    it('should prefer webhooks to send a message', async () => {
      await bot.sendToDiscord('nick', '#irc', 'text');
      expect(sendWebhookMessageStub).toHaveBeenCalled();
    });

    it('pads too short usernames', async () => {
      const text = 'message';
      await bot.sendToDiscord('n', '#irc', text);
      expect(sendWebhookMessageStub).toHaveBeenCalledWith(text, {
        username: 'n_',
        avatarURL: null,
        disableMentions: 'everyone',
      });
    });

    it('slices too long usernames', async () => {
      const text = 'message';
      await bot.sendToDiscord(
        '1234567890123456789012345678901234567890',
        '#irc',
        text,
      );
      expect(sendWebhookMessageStub).toHaveBeenCalledWith(text, {
        username: '12345678901234567890123456789012',
        avatarURL: null,
        disableMentions: 'everyone',
      });
    });

    it('does not ping everyone if user lacks permission', async () => {
      const text = 'message';
      const permission =
        discord.Permissions.FLAGS.VIEW_CHANNEL +
        discord.Permissions.FLAGS.SEND_MESSAGES;
      bot.discord.channels.cache
        .get('1234')!
        // @ts-expect-error apparently exists but not exposed in types
        .setPermissionStub(
          bot.discord.user,
          new discord.Permissions(permission),
        );
      await bot.sendToDiscord('nick', '#irc', text);
      expect(sendWebhookMessageStub).toHaveBeenCalledWith(text, {
        username: 'nick',
        avatarURL: null,
        disableMentions: 'everyone',
      });
    });

    it('sends @everyone messages if the bot has permission to do so', async () => {
      const text = 'message';
      const permission =
        discord.Permissions.FLAGS.VIEW_CHANNEL +
        discord.Permissions.FLAGS.SEND_MESSAGES +
        discord.Permissions.FLAGS.MENTION_EVERYONE;
      bot.discord.channels.cache
        .get('1234')!
        // @ts-expect-error apparently exists but not exposed in types
        .setPermissionStub(
          bot.discord.user,
          new discord.Permissions(permission),
        );
      await bot.sendToDiscord('nick', '#irc', text);
      expect(sendWebhookMessageStub).toHaveBeenCalledWith(text, {
        username: 'nick',
        avatarURL: null,
        disableMentions: 'none',
      });
    });

    const setupUser = () => {
      const userObj = { id: 123, username: 'Nick', avatar: 'avatarURL' };
      const memberObj = { nickname: 'Different' };
      addUser(userObj, memberObj);
    };

    const setupCommonPair = () => {
      const userObj1 = { id: 124, username: 'common', avatar: 'avatarURL' };
      const userObj2 = { id: 125, username: 'diffUser', avatar: 'avatarURL' };
      const memberObj1 = { nickname: 'diffNick' };
      const memberObj2 = { nickname: 'common' };
      addUser(userObj1, memberObj1);
      addUser(userObj2, memberObj2);
    };

    describe('when matching avatars', async () => {
      beforeEach(async () => {
        setupUser();
      });

      it("should match a user's username", async () => {
        expect(bot.getDiscordAvatar('Nick', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
      });

      it("should match a user's username case insensitively", async () => {
        expect(bot.getDiscordAvatar('nick', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
      });

      it("should match a user's nickname", async () => {
        expect(bot.getDiscordAvatar('Different', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
      });

      it("should match a user's nickname case insensitively", async () => {
        expect(bot.getDiscordAvatar('different', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
      });

      it("should only return matching users' avatars", async () => {
        expect(bot.getDiscordAvatar('other', '#irc')).to.equal(null);
      });

      it('should return no avatar when there are multiple matches', async () => {
        setupCommonPair();
        expect(bot.getDiscordAvatar('diffUser', '#irc')).not.toBe(null);
        expect(bot.getDiscordAvatar('diffNick', '#irc')).not.toBe(null);
        expect(bot.getDiscordAvatar('common', '#irc')).to.equal(null);
      });

      it('should handle users without nicknames', async () => {
        const userObj = {
          id: 124,
          username: 'nickless',
          avatar: 'nickless-avatar',
        };
        const memberObj = {};
        addUser(userObj, memberObj);
        expect(bot.getDiscordAvatar('nickless', '#irc')).toEqual(
          '/avatars/124/nickless-avatar.png?size=128',
        );
      });

      it('should handle users without avatars', async () => {
        const userObj = { id: 124, username: 'avatarless' };
        const memberObj = {};
        addUser(userObj, memberObj);
        expect(bot.getDiscordAvatar('avatarless', '#irc')).to.equal(null);
      });
    });

    describe('when matching avatars with fallback URL', async () => {
      beforeEach(async () => {
        const newConfig = {
          ...config,
          webhooks: { '#discord': 'https://discord.com/api/webhooks/id/token' },
          format: { webhookAvatarURL: 'avatarFrom/{$nickname}' },
        };
        await setCustomBot(newConfig);

        setupUser();
      });

      it("should use a matching user's avatar", async () => {
        expect(bot.getDiscordAvatar('Nick', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
        expect(bot.getDiscordAvatar('nick', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
        expect(bot.getDiscordAvatar('Different', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
        expect(bot.getDiscordAvatar('different', '#irc')).toEqual(
          '/avatars/123/avatarURL.png?size=128',
        );
      });

      it('should use fallback without matching user', async () => {
        expect(bot.getDiscordAvatar('other', '#irc')).toEqual(
          'avatarFrom/other',
        );
      });

      it('should use fallback when there are multiple matches', async () => {
        setupCommonPair();
        expect(bot.getDiscordAvatar('diffUser', '#irc')).toEqual(
          '/avatars/125/avatarURL.png?size=128',
        );
        expect(bot.getDiscordAvatar('diffNick', '#irc')).toEqual(
          '/avatars/124/avatarURL.png?size=128',
        );
        expect(bot.getDiscordAvatar('common', '#irc')).toEqual(
          'avatarFrom/common',
        );
      });

      it('should use fallback for users without avatars', async () => {
        const userObj = { id: 124, username: 'avatarless' };
        const memberObj = {};
        addUser(userObj, memberObj);
        expect(bot.getDiscordAvatar('avatarless', '#irc')).toEqual(
          'avatarFrom/avatarless',
        );
      });
    });
  });

  it('should not send messages to Discord if IRC user is ignored', async () => {
    await bot.sendToDiscord('irc_ignored_user', '#irc', 'message');
    expect(sendStub).not.toHaveBeenCalled();
  });

  it('should not send messages to IRC if Discord user is ignored', async () => {
    const message = {
      content: 'text',
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'discord_ignored_user',
        id: 'some id',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock).not.toHaveBeenCalled();
  });

  it('should not send messages to IRC if Discord user is ignored by id', async () => {
    const message = {
      content: 'text',
      mentions: { users: [] },
      channel: {
        name: 'discord',
      },
      author: {
        username: 'vasya_pupkin',
        id: '4499',
      },
      guild: guild,
    };

    bot.sendToIRC(message);
    expect(sayMock).not.toHaveBeenCalled();
  });
});

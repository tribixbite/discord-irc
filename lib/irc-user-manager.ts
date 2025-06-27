import { logger } from './logger';
import { Client as IRCClient } from 'irc-upd';

export interface IRCUserInfo {
  nick: string;
  username?: string;
  realname?: string;
  hostname?: string;
  ip?: string;
  server?: string;
  channels: string[];
  modes: string[];
  isOperator: boolean;
  isVoiced: boolean;
  isAway: boolean;
  awayMessage?: string;
  idleTime?: number;
  signonTime?: number;
  lastSeen: number;
  account?: string; // Services account name
  isSecure: boolean; // SSL connection
}

export interface IRCChannelInfo {
  name: string;
  topic?: string;
  topicSetBy?: string;
  topicSetAt?: number;
  modes: string[];
  userCount: number;
  users: Map<string, IRCChannelUser>;
  created?: number;
}

export interface IRCChannelUser {
  nick: string;
  modes: string[]; // @, +, etc.
  isOperator: boolean;
  isVoiced: boolean;
  isHalfOperator: boolean;
  joinTime: number;
}

export interface IRCServerInfo {
  name: string;
  version?: string;
  network?: string;
  supportedFeatures: Map<string, string | boolean>;
  motd: string[];
  userModes: string[];
  channelModes: string[];
  prefixes: Map<string, string>; // @ -> o, + -> v, etc.
}

export class IRCUserManager {
  private users: Map<string, IRCUserInfo> = new Map();
  private channels: Map<string, IRCChannelInfo> = new Map();
  private serverInfo: IRCServerInfo;
  private ircClient: IRCClient;
  private userInfoRequests: Map<string, NodeJS.Timeout> = new Map();
  private pendingWhoisRequests: Set<string> = new Set();
  private pendingWhoRequests: Map<string, { resolve: (users: IRCUserInfo[]) => void; timeout: NodeJS.Timeout; users: IRCUserInfo[] }> = new Map();

  constructor(ircClient: IRCClient) {
    this.ircClient = ircClient;
    this.serverInfo = {
      name: '',
      supportedFeatures: new Map(),
      motd: [],
      userModes: [],
      channelModes: [],
      prefixes: new Map([
        ['@', 'o'], // operator
        ['+', 'v'], // voice
        ['%', 'h'], // halfop
        ['&', 'a'], // admin
        ['~', 'q'], // owner
      ])
    };

    this.setupEventHandlers();
    logger.info('IRC User Manager initialized');
  }

  private setupEventHandlers(): void {
    // Handle server capabilities and features
    this.ircClient.on('raw', (message) => {
      this.handleRawMessage(message);
    });

    // Handle user joins
    this.ircClient.on('join', (channelName: string, nick: string) => {
      this.handleUserJoin(channelName, nick);
    });

    // Handle user parts
    this.ircClient.on('part', (channelName: string, nick: string) => {
      this.handleUserPart(channelName, nick);
    });

    // Handle user quits
    this.ircClient.on('quit', (nick: string, _reason?: string, channels?: string[]) => {
      this.handleUserQuit(nick, channels);
    });

    // Handle nick changes
    this.ircClient.on('nick', (oldNick: string, newNick: string) => {
      this.handleNickChange(oldNick, newNick);
    });

    // Handle names response (user list for channel)
    this.ircClient.on('names', (channelName: string, nicks: Record<string, string>) => {
      this.handleNamesResponse(channelName, nicks);
    });

    // Handle channel topic
    this.ircClient.on('topic', (channelName: string, topic: string, nick?: string) => {
      this.handleTopicChange(channelName, topic, nick);
    });

    // Handle mode changes
    this.ircClient.on('mode', (channelName: string, by: string, mode: string, argument?: string, adding?: boolean) => {
      this.handleModeChange(channelName, by, mode, argument, adding);
    });
  }

  private handleRawMessage(message: { command: string; args?: string[]; server?: string }): void {
    const command = message.command;
    const params = message.args || [];

    switch (command) {
      case '005': // RPL_ISUPPORT - Server capabilities
        this.parseServerCapabilities(params);
        break;
      
      case '311': // RPL_WHOISUSER
        this.parseWhoisUser(params);
        break;
      
      case '312': // RPL_WHOISSERVER
        this.parseWhoisServer(params);
        break;
      
      case '313': // RPL_WHOISOPERATOR
        this.parseWhoisOperator(params);
        break;
      
      case '317': // RPL_WHOISIDLE
        this.parseWhoisIdle(params);
        break;
      
      case '319': // RPL_WHOISCHANNELS
        this.parseWhoisChannels(params);
        break;
      
      case '330': // RPL_WHOISACCOUNT (services account)
        this.parseWhoisAccount(params);
        break;
      
      case '671': // RPL_WHOISSECURE (SSL connection)
        this.parseWhoisSecure(params);
        break;
      
      case '318': // RPL_ENDOFWHOIS
        this.handleEndOfWhois(params);
        break;

      case '353': // RPL_NAMREPLY - Names list
        this.parseNamesReply(params);
        break;
      
      case '366': // RPL_ENDOFNAMES
        // Names list complete
        break;
      
      case '367': // RPL_BANLIST
        this.parseBanList(params);
        break;

      case '352': // RPL_WHOREPLY
        this.parseWhoReply(params);
        break;
      
      case '315': // RPL_ENDOFWHO
        this.handleEndOfWho(params);
        break;

      case '001': // RPL_WELCOME
        this.serverInfo.name = message.server || '';
        break;
    }
  }

  private parseServerCapabilities(params: string[]): void {
    for (const param of params.slice(1)) { // Skip the nick parameter
      if (param.includes('=')) {
        const [key, value] = param.split('=', 2);
        this.serverInfo.supportedFeatures.set(key, value);
      } else {
        this.serverInfo.supportedFeatures.set(param, true);
      }
    }

    // Parse PREFIX for mode symbols
    const prefixParam = this.serverInfo.supportedFeatures.get('PREFIX') as string;
    if (prefixParam) {
      const match = prefixParam.match(/\(([^)]+)\)(.*)/);
      if (match) {
        const modes = match[1];
        const symbols = match[2];
        this.serverInfo.prefixes.clear();
        for (let i = 0; i < modes.length && i < symbols.length; i++) {
          this.serverInfo.prefixes.set(symbols[i], modes[i]);
        }
      }
    }

    // Parse CHANMODES
    const chanmodesParam = this.serverInfo.supportedFeatures.get('CHANMODES') as string;
    if (chanmodesParam) {
      this.serverInfo.channelModes = chanmodesParam.split(',').flat();
    }
  }

  private parseWhoisUser(params: string[]): void {
    if (params.length < 6) return;
    const [, nick, username, hostname, , realname] = params;
    
    let user = this.users.get(nick.toLowerCase());
    if (!user) {
      user = this.createUserInfo(nick);
      this.users.set(nick.toLowerCase(), user);
    }

    user.username = username;
    user.hostname = hostname;
    user.realname = realname;
    user.lastSeen = Date.now();

    logger.debug(`Updated user info for ${nick}:`, { username, hostname, realname });
  }

  private parseWhoisServer(params: string[]): void {
    if (params.length < 4) return;
    const [, nick, server] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.server = server;
    }
  }

  private parseWhoisOperator(params: string[]): void {
    if (params.length < 2) return;
    const [, nick] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.isOperator = true;
    }
  }

  private parseWhoisIdle(params: string[]): void {
    if (params.length < 4) return;
    const [, nick, idleTimeStr, signonTimeStr] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.idleTime = parseInt(idleTimeStr, 10);
      user.signonTime = parseInt(signonTimeStr, 10) * 1000; // Convert to milliseconds
    }
  }

  private parseWhoisChannels(params: string[]): void {
    if (params.length < 3) return;
    const [, nick, channelsStr] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      // Parse channels with modes like "@#channel +#anotherchannel"
      const channels = channelsStr.split(' ').map(ch => {
        const trimmed = ch.trim();
        return trimmed.replace(/^[@+%&~]/, ''); // Remove mode prefixes
      }).filter(ch => ch.length > 0);
      
      user.channels = channels;
    }
  }

  private parseWhoisAccount(params: string[]): void {
    if (params.length < 4) return;
    const [, nick, account] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.account = account;
    }
  }

  private parseWhoisSecure(params: string[]): void {
    if (params.length < 2) return;
    const [, nick] = params;
    
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.isSecure = true;
    }
  }

  private handleEndOfWhois(params: string[]): void {
    if (params.length < 2) return;
    const [, nick] = params;
    
    this.pendingWhoisRequests.delete(nick.toLowerCase());
    logger.debug(`Completed WHOIS for ${nick}`);
  }

  private parseNamesReply(params: string[]): void {
    if (params.length < 4) return;
    const [, , channelName, namesStr] = params;
    
    this.handleNamesResponse(channelName, this.parseNamesString(namesStr));
  }

  private parseNamesString(namesStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    const names = namesStr.split(' ').filter(name => name.trim());
    
    for (const name of names) {
      const trimmed = name.trim();
      if (trimmed) {
        // Extract mode prefix and nick
        const modeMatch = trimmed.match(/^([@+%&~]*)(.+)$/);
        if (modeMatch) {
          const [, modes, nick] = modeMatch;
          result[nick] = modes || '';
        }
      }
    }
    
    return result;
  }

  private parseBanList(params: string[]): void {
    // Handle ban list if needed for comprehensive channel info
    if (params.length < 4) return;
    // Implementation can be added if ban list tracking is needed
  }

  private parseWhoReply(params: string[]): void {
    // WHO reply format: nick channel username host server nick flags :realname
    if (params.length < 8) return;
    
    const [, channel, username, hostname, server, nick, flags, ...realnameArray] = params;
    const realname = realnameArray.join(' ').replace(/^:/, '');
    
    let user = this.users.get(nick.toLowerCase());
    if (!user) {
      user = this.createUserInfo(nick);
      this.users.set(nick.toLowerCase(), user);
    }

    // Update user info from WHO reply
    user.username = username;
    user.hostname = hostname;
    user.server = server;
    user.realname = realname;
    user.lastSeen = Date.now();
    
    // Parse flags: H=here, G=away, *=oper, @=chanop, +=voice
    user.isAway = flags.includes('G');
    user.isOperator = flags.includes('*');
    
    // Add to any pending WHO requests
    for (const [requestId, request] of this.pendingWhoRequests.entries()) {
      if (!request.users.find(u => u.nick.toLowerCase() === nick.toLowerCase())) {
        request.users.push({ ...user });
      }
    }

    logger.debug(`Updated user info from WHO: ${nick}`, { username, hostname, server });
  }

  private handleEndOfWho(params: string[]): void {
    if (params.length < 3) return;
    const [, target] = params;
    
    // Resolve any pending WHO requests for this target
    const request = this.pendingWhoRequests.get(target);
    if (request) {
      clearTimeout(request.timeout);
      request.resolve(request.users);
      this.pendingWhoRequests.delete(target);
      logger.debug(`Completed WHO request for ${target}, found ${request.users.length} users`);
    }
  }

  private handleUserJoin(channelName: string, nick: string): void {
    // Update user info
    let user = this.users.get(nick.toLowerCase());
    if (!user) {
      user = this.createUserInfo(nick);
      this.users.set(nick.toLowerCase(), user);
    }

    if (!user.channels.includes(channelName)) {
      user.channels.push(channelName);
    }
    user.lastSeen = Date.now();

    // Update channel info
    let channel = this.channels.get(channelName.toLowerCase());
    if (!channel) {
      channel = this.createChannelInfo(channelName);
      this.channels.set(channelName.toLowerCase(), channel);
    }

    channel.users.set(nick.toLowerCase(), {
      nick,
      modes: [],
      isOperator: false,
      isVoiced: false,
      isHalfOperator: false,
      joinTime: Date.now()
    });
    channel.userCount = channel.users.size;

    // Request detailed user info if we don't have it
    this.requestUserInfo(nick);
  }

  private handleUserPart(channelName: string, nick: string): void {
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.channels = user.channels.filter(ch => ch !== channelName);
      user.lastSeen = Date.now();
    }

    const channel = this.channels.get(channelName.toLowerCase());
    if (channel) {
      channel.users.delete(nick.toLowerCase());
      channel.userCount = channel.users.size;
    }
  }

  private handleUserQuit(nick: string, channels?: string[]): void {
    const user = this.users.get(nick.toLowerCase());
    if (user) {
      user.channels = [];
      user.lastSeen = Date.now();
    }

    // Remove from all channels
    for (const channel of this.channels.values()) {
      if (channel.users.delete(nick.toLowerCase())) {
        channel.userCount = channel.users.size;
      }
    }
  }

  private handleNickChange(oldNick: string, newNick: string): void {
    const user = this.users.get(oldNick.toLowerCase());
    if (user) {
      user.nick = newNick;
      user.lastSeen = Date.now();
      
      // Update the map key
      this.users.delete(oldNick.toLowerCase());
      this.users.set(newNick.toLowerCase(), user);

      // Update channel user maps
      for (const channel of this.channels.values()) {
        const channelUser = channel.users.get(oldNick.toLowerCase());
        if (channelUser) {
          channelUser.nick = newNick;
          channel.users.delete(oldNick.toLowerCase());
          channel.users.set(newNick.toLowerCase(), channelUser);
        }
      }
    }
  }

  private handleNamesResponse(channelName: string, nicks: Record<string, string>): void {
    let channel = this.channels.get(channelName.toLowerCase());
    if (!channel) {
      channel = this.createChannelInfo(channelName);
      this.channels.set(channelName.toLowerCase(), channel);
    }

    // Clear existing users and rebuild
    channel.users.clear();
    
    for (const [nick, modes] of Object.entries(nicks)) {
      const channelUser: IRCChannelUser = {
        nick,
        modes: modes.split(''),
        isOperator: modes.includes('@'),
        isVoiced: modes.includes('+'),
        isHalfOperator: modes.includes('%'),
        joinTime: Date.now() // We don't know the actual join time
      };
      
      channel.users.set(nick.toLowerCase(), channelUser);

      // Update or create user info
      let user = this.users.get(nick.toLowerCase());
      if (!user) {
        user = this.createUserInfo(nick);
        this.users.set(nick.toLowerCase(), user);
      }

      if (!user.channels.includes(channelName)) {
        user.channels.push(channelName);
      }
      user.lastSeen = Date.now();

      // Update user modes based on channel modes
      user.isOperator = user.isOperator || channelUser.isOperator;
      user.isVoiced = user.isVoiced || channelUser.isVoiced;

      // Request detailed info for users we don't know much about
      if (!user.hostname) {
        this.requestUserInfo(nick);
      }
    }

    channel.userCount = channel.users.size;
    logger.debug(`Updated channel ${channelName} with ${channel.userCount} users`);
  }

  private handleTopicChange(channelName: string, topic: string, nick?: string): void {
    let channel = this.channels.get(channelName.toLowerCase());
    if (!channel) {
      channel = this.createChannelInfo(channelName);
      this.channels.set(channelName.toLowerCase(), channel);
    }

    channel.topic = topic;
    channel.topicSetBy = nick;
    channel.topicSetAt = Date.now();
  }

  private handleModeChange(channelName: string, by: string, mode: string, argument?: string, adding?: boolean): void {
    const channel = this.channels.get(channelName.toLowerCase());
    if (!channel) return;

    // Handle user mode changes
    if (argument && channel.users.has(argument.toLowerCase())) {
      const channelUser = channel.users.get(argument.toLowerCase())!;
      
      if (adding) {
        if (!channelUser.modes.includes(mode)) {
          channelUser.modes.push(mode);
        }
      } else {
        channelUser.modes = channelUser.modes.filter(m => m !== mode);
      }

      // Update convenience flags
      channelUser.isOperator = channelUser.modes.includes('@') || channelUser.modes.includes('o');
      channelUser.isVoiced = channelUser.modes.includes('+') || channelUser.modes.includes('v');
      channelUser.isHalfOperator = channelUser.modes.includes('%') || channelUser.modes.includes('h');

      // Update user's global info
      const user = this.users.get(argument.toLowerCase());
      if (user) {
        user.isOperator = user.isOperator || channelUser.isOperator;
        user.isVoiced = user.isVoiced || channelUser.isVoiced;
      }
    }

    // Handle channel mode changes
    if (adding) {
      if (!channel.modes.includes(mode)) {
        channel.modes.push(mode);
      }
    } else {
      channel.modes = channel.modes.filter(m => m !== mode);
    }
  }

  private createUserInfo(nick: string): IRCUserInfo {
    return {
      nick,
      channels: [],
      modes: [],
      isOperator: false,
      isVoiced: false,
      isAway: false,
      lastSeen: Date.now(),
      isSecure: false
    };
  }

  private createChannelInfo(name: string): IRCChannelInfo {
    return {
      name,
      modes: [],
      userCount: 0,
      users: new Map()
    };
  }

  private requestUserInfo(nick: string): void {
    const key = nick.toLowerCase();
    
    // Avoid spamming WHOIS requests
    if (this.pendingWhoisRequests.has(key)) {
      return;
    }

    // Clear any existing timeout
    const existingTimeout = this.userInfoRequests.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Rate limit WHOIS requests
    const timeout = setTimeout(() => {
      if (!this.pendingWhoisRequests.has(key)) {
        this.pendingWhoisRequests.add(key);
        this.ircClient.whois(nick);
        logger.debug(`Requested WHOIS for ${nick}`);
      }
      this.userInfoRequests.delete(key);
    }, 1000); // 1 second delay

    this.userInfoRequests.set(key, timeout);
  }

  // Public API methods

  /**
   * Get information about a specific user
   */
  public getUserInfo(nick: string): IRCUserInfo | undefined {
    const user = this.users.get(nick.toLowerCase());
    if (user && (!user.hostname || Date.now() - user.lastSeen > 300000)) { // Refresh if stale (5 minutes)
      this.requestUserInfo(nick);
    }
    return user;
  }

  /**
   * Get all users in a channel
   */
  public getChannelUsers(channelName: string): IRCChannelUser[] {
    const channel = this.channels.get(channelName.toLowerCase());
    return channel ? Array.from(channel.users.values()) : [];
  }

  /**
   * Get channel information
   */
  public getChannelInfo(channelName: string): IRCChannelInfo | undefined {
    return this.channels.get(channelName.toLowerCase());
  }

  /**
   * Get all tracked users
   */
  public getAllUsers(): IRCUserInfo[] {
    return Array.from(this.users.values());
  }

  /**
   * Get all tracked channels
   */
  public getAllChannels(): IRCChannelInfo[] {
    return Array.from(this.channels.values());
  }

  /**
   * Search users by various criteria
   */
  public searchUsers(query: {
    nick?: string;
    hostname?: string;
    realname?: string;
    channel?: string;
    isOperator?: boolean;
    isSecure?: boolean;
  }): IRCUserInfo[] {
    return this.getAllUsers().filter(user => {
      if (query.nick && !user.nick.toLowerCase().includes(query.nick.toLowerCase())) return false;
      if (query.hostname && (!user.hostname || !user.hostname.toLowerCase().includes(query.hostname.toLowerCase()))) return false;
      if (query.realname && (!user.realname || !user.realname.toLowerCase().includes(query.realname.toLowerCase()))) return false;
      if (query.channel && !user.channels.some(ch => ch.toLowerCase() === query.channel!.toLowerCase())) return false;
      if (query.isOperator !== undefined && user.isOperator !== query.isOperator) return false;
      if (query.isSecure !== undefined && user.isSecure !== query.isSecure) return false;
      return true;
    });
  }

  /**
   * Get server information
   */
  public getServerInfo(): IRCServerInfo {
    return { ...this.serverInfo };
  }

  /**
   * Execute WHO command to find users matching a pattern
   */
  public async whoQuery(pattern: string): Promise<IRCUserInfo[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingWhoRequests.delete(pattern);
        reject(new Error(`WHO query timeout for pattern: ${pattern}`));
      }, 30000); // 30 second timeout

      this.pendingWhoRequests.set(pattern, {
        resolve,
        timeout,
        users: []
      });

      // Send WHO command
      this.ircClient.send('WHO', pattern);
      logger.debug(`Sent WHO command for pattern: ${pattern}`);
    });
  }

  /**
   * Force refresh user information
   */
  public refreshUserInfo(nick: string): void {
    this.requestUserInfo(nick);
  }

  /**
   * Get statistics
   */
  public getStats(): {
    totalUsers: number;
    totalChannels: number;
    usersWithFullInfo: number;
    operatorCount: number;
    secureUsers: number;
  } {
    const users = this.getAllUsers();
    return {
      totalUsers: users.length,
      totalChannels: this.channels.size,
      usersWithFullInfo: users.filter(u => u.hostname && u.username).length,
      operatorCount: users.filter(u => u.isOperator).length,
      secureUsers: users.filter(u => u.isSecure).length
    };
  }

  /**
   * Clean up stale user data
   */
  public cleanup(): void {
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [key, user] of this.users.entries()) {
      if (user.channels.length === 0 && now - user.lastSeen > staleThreshold) {
        this.users.delete(key);
      }
    }

    // Clear pending requests
    for (const timeout of this.userInfoRequests.values()) {
      clearTimeout(timeout);
    }
    this.userInfoRequests.clear();
    this.pendingWhoisRequests.clear();

    logger.debug('Cleaned up stale user data');
  }
}
import { 
  CommandInteraction, 
  Permissions,
  MessageEmbed,
  MessageAttachment,
  ApplicationCommandData
} from 'discord.js';
import { logger } from './logger';
import Bot from './bot';

export interface SlashCommand {
  data: ApplicationCommandData;
  execute: (interaction: CommandInteraction, bot: Bot) => Promise<void>;
}

// Admin permission check
function hasAdminPermission(interaction: CommandInteraction): boolean {
  if (!interaction.member || !interaction.guild) return false;
  
  // Check if user has administrator permission
  if (typeof interaction.member.permissions === 'string') return false;
  return interaction.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR);
}

// Status command - show bot health and stats
export const statusCommand: SlashCommand = {
  data: {
    name: 'irc-status',
    description: 'Show IRC bridge status and statistics',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const embed = new MessageEmbed()
        .setTitle('🔗 IRC Bridge Status')
        .setColor(0x00ff00)
        .setTimestamp();

      // Basic bot info
      embed.addField('🌐 IRC Server', `${bot.server}`, true);
      embed.addField('👤 Bot Nickname', `${bot.nickname}`, true);
      embed.addField('📊 Channels Mapped', `${Object.keys(bot.channelMapping).length}`, true);

      // Channel users info
      const totalTrackedUsers = Object.values(bot.channelUsers)
        .reduce((total: number, users) => total + (users as Set<string>).size, 0);
      
      embed.addField('👥 Tracked IRC Users', `${totalTrackedUsers}`, true);
      embed.addField('💬 PM Threads', `${bot.pmThreads.size}`, true);
      embed.addField('🏠 PM Channel', bot.pmChannelId ? `<#${bot.pmChannelId}>` : 'Not configured', true);

      // Message sync stats
      const syncStats = bot.messageSync.getStats();
      embed.addField('📝 Tracked Messages', `${syncStats.trackedMessages}`, true);
      embed.addField('⏰ Edit Window', `${syncStats.editWindowMinutes} min`, true);

      // Rate limiting stats
      const rateLimitStats = bot.rateLimiter.getStats();
      embed.addField('🚫 Blocked Users', `${rateLimitStats.blockedUsers}`, true);
      embed.addField('⚠️ Recent Warnings', `${rateLimitStats.recentWarnings}`, true);
      embed.addField('👤 Active Users', `${rateLimitStats.activeUsers}`, true);

      // Get some persistence metrics
      if (bot.persistence) {
        try {
          const uptime = await bot.persistence.getMetric('uptime_start');
          if (uptime) {
            const startTime = parseInt(uptime);
            const uptimeMs = Date.now() - startTime;
            const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
            embed.addField('⏱️ Uptime', `${uptimeHours} hours`, true);
          }
        } catch (error) {
          logger.warn('Failed to get uptime metric:', error);
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      logger.error('Error in status command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve status information.', 
        ephemeral: true 
      });
    }
  }
};

// Channel users command - list users in IRC channels
export const usersCommand: SlashCommand = {
  data: {
    name: 'irc-users',
    description: 'List users in IRC channels',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        name: 'channel',
        description: 'IRC channel name (without #)',
        type: 'STRING' as const,
        required: false,
      }
    ]
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const channelName = interaction.options.getString('channel');
      const embed = new MessageEmbed()
        .setTitle('👥 IRC Channel Users')
        .setColor(0x0099ff)
        .setTimestamp();

      if (channelName) {
        // Show users for specific channel
        const fullChannelName = channelName.startsWith('#') ? channelName : `#${channelName}`;
        const lowerChannelName = fullChannelName.toLowerCase();
        const users = bot.channelUsers[lowerChannelName];
        
        if (users && users.size > 0) {
          const userList = Array.from(users).sort().join(', ');
          embed.addField(
            `${fullChannelName} (${users.size} users)`, 
            userList.length > 1024 ? userList.substring(0, 1021) + '...' : userList
          );
        } else {
          embed.addField(
            fullChannelName, 
            'No users tracked (channel not found or not joined)'
          );
        }
      } else {
        // Show all channels and user counts
        const channels = Object.keys(bot.channelUsers).sort();
        if (channels.length === 0) {
          embed.setDescription('No IRC channels are currently being tracked.');
        } else {
          const channelInfo = channels.map(channel => {
            const userCount = bot.channelUsers[channel].size;
            return `**${channel}**: ${userCount} users`;
          }).join('\n');
          
          embed.setDescription(channelInfo.length > 4096 ? 
            channelInfo.substring(0, 4093) + '...' : channelInfo);
        }
      }

      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      logger.error('Error in users command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve user information.', 
        ephemeral: true 
      });
    }
  }
};

// PM management command
export const pmCommand: SlashCommand = {
  data: {
    name: 'irc-pm',
    description: 'Manage IRC private message threads',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        name: 'list',
        description: 'List active PM threads',
        type: 'SUB_COMMAND' as const,
      },
      {
        name: 'cleanup',
        description: 'Clean up inactive PM threads',
        type: 'SUB_COMMAND' as const,
      },
      {
        name: 'close',
        description: 'Close a specific PM thread',
        type: 'SUB_COMMAND' as const,
        options: [
          {
            name: 'nickname',
            description: 'IRC nickname to close PM thread for',
            type: 'STRING' as const,
            required: true,
          }
        ]
      }
    ]
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    
    try {
      switch (subcommand) {
        case 'list': {
          const embed = new MessageEmbed()
            .setTitle('💬 Active PM Threads')
            .setColor(0xff9900)
            .setTimestamp();

          if (bot.pmThreads.size === 0) {
            embed.setDescription('No active PM threads.');
          } else {
            const threadList = Array.from(bot.pmThreads.entries())
              .map(([nick, threadId]) => `**${nick}**: <#${threadId}>`)
              .join('\n');
            
            embed.setDescription(threadList.length > 4096 ? 
              threadList.substring(0, 4093) + '...' : threadList);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }
        
        case 'cleanup': {
          if (!bot.persistence) {
            await interaction.reply({ 
              content: '❌ Persistence service not available.', 
              ephemeral: true 
            });
            return;
          }

          await bot.persistence.cleanup();
          await interaction.reply({ 
            content: '✅ PM thread cleanup completed.', 
            ephemeral: true 
          });
          break;
        }
        
        case 'close': {
          const nickname = interaction.options.getString('nickname', true);
          const threadId = bot.pmThreads.get(nickname.toLowerCase());
          
          if (!threadId) {
            await interaction.reply({ 
              content: `❌ No active PM thread found for ${nickname}.`, 
              ephemeral: true 
            });
            return;
          }

          // Remove from memory
          bot.pmThreads.delete(nickname.toLowerCase());
          
          // Remove from persistence
          if (bot.persistence) {
            await bot.persistence.deletePMThread(nickname);
          }

          // Try to archive the thread
          try {
            const channel = await bot.discord.channels.fetch(threadId);
            if (channel?.isThread()) {
              await channel.setArchived(true);
            }
          } catch (error) {
            logger.warn('Failed to archive thread:', error);
          }

          await interaction.reply({ 
            content: `✅ Closed PM thread for ${nickname}.`, 
            ephemeral: true 
          });
          break;
        }
        
        default:
          await interaction.reply({ 
            content: '❌ Unknown subcommand.', 
            ephemeral: true 
          });
      }
      
    } catch (error) {
      logger.error('Error in PM command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute PM command.', 
        ephemeral: true 
      });
    }
  }
};

// Reconnect command - force IRC reconnection
export const reconnectCommand: SlashCommand = {
  data: {
    name: 'irc-reconnect',
    description: 'Force IRC client to reconnect',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
  },
  
  async execute(interaction: CommandInteraction, bot: Bot) {
    if (!hasAdminPermission(interaction)) {
      await interaction.reply({ 
        content: '❌ You need administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      await interaction.reply({ 
        content: '🔄 Initiating IRC reconnection...', 
        ephemeral: true 
      });

      // Disconnect and reconnect IRC client
      bot.ircClient.disconnect('Manual reconnect requested', () => {
        logger.info('IRC client disconnected for manual reconnection');
        // Give it a moment before reconnecting
        setTimeout(() => {
          bot.ircClient.connect();
        }, 2000);
      });
      
    } catch (error) {
      logger.error('Error in reconnect command:', error);
      await interaction.followUp({ 
        content: '❌ Failed to reconnect IRC client.', 
        ephemeral: true 
      });
    }
  }
};

// Rate limit management command
export const rateLimitCommand: SlashCommand = {
  data: {
    name: 'irc-ratelimit',
    description: 'Manage IRC bridge rate limiting',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'status',
        description: 'Show detailed rate limit statistics'
      },
      {
        type: 'SUB_COMMAND',
        name: 'blocked',
        description: 'List currently blocked users'
      },
      {
        type: 'SUB_COMMAND',
        name: 'unblock',
        description: 'Unblock a specific user',
        options: [
          {
            type: 'STRING',
            name: 'user',
            description: 'Username or user ID to unblock',
            required: true
          }
        ]
      },
      {
        type: 'SUB_COMMAND',
        name: 'clear',
        description: 'Clear warnings for a specific user',
        options: [
          {
            type: 'STRING',
            name: 'user',
            description: 'Username or user ID to clear warnings for',
            required: true
          }
        ]
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'status': {
          const stats = bot.rateLimiter.getStats();
          const embed = new MessageEmbed()
            .setTitle('🚦 Rate Limiting Statistics')
            .setColor('#FFA500')
            .addField('Total Users Tracked', `${stats.totalUsers}`, true)
            .addField('Currently Blocked', `${stats.blockedUsers}`, true)
            .addField('Active Users (1h)', `${stats.activeUsers}`, true)
            .addField('Recent Warnings (24h)', `${stats.recentWarnings}`, true)
            .addField('Total Messages Processed', `${stats.totalMessages}`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'blocked': {
          const blockedUsers = bot.rateLimiter.getBlockedUsers();
          
          if (blockedUsers.length === 0) {
            await interaction.reply({ 
              content: '✅ No users are currently blocked.', 
              ephemeral: true 
            });
            return;
          }

          const embed = new MessageEmbed()
            .setTitle('🚫 Currently Blocked Users')
            .setColor('#FF0000')
            .setTimestamp();

          const now = Date.now();
          const userList = blockedUsers.slice(0, 25).map(user => {
            const remainingTime = Math.ceil((user.blockedUntil - now) / 1000);
            const userType = user.userId.startsWith('irc:') ? 'IRC' : 'Discord';
            const displayName = user.userId.startsWith('irc:') ? user.userId.slice(4) : user.username;
            return `**${displayName}** (${userType}) - ${remainingTime}s remaining (${user.warningCount} warnings)`;
          }).join('\n');

          embed.setDescription(userList);
          
          if (blockedUsers.length > 25) {
            embed.setFooter({ text: `Showing 25 of ${blockedUsers.length} blocked users` });
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'unblock': {
          const userInput = interaction.options.getString('user', true);
          
          // Try both direct match and IRC prefixed match
          let success = bot.rateLimiter.unblockUser(userInput);
          if (!success && !userInput.startsWith('irc:')) {
            success = bot.rateLimiter.unblockUser(`irc:${userInput}`);
          }

          if (success) {
            await interaction.reply({ 
              content: `✅ Successfully unblocked user: ${userInput}`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `❌ User not found or not currently blocked: ${userInput}`, 
              ephemeral: true 
            });
          }
          break;
        }

        case 'clear': {
          const userInput = interaction.options.getString('user', true);
          
          // Try both direct match and IRC prefixed match
          let success = bot.rateLimiter.clearWarnings(userInput);
          if (!success && !userInput.startsWith('irc:')) {
            success = bot.rateLimiter.clearWarnings(`irc:${userInput}`);
          }

          if (success) {
            await interaction.reply({ 
              content: `✅ Successfully cleared warnings for user: ${userInput}`, 
              ephemeral: true 
            });
          } else {
            await interaction.reply({ 
              content: `❌ User not found: ${userInput}`, 
              ephemeral: true 
            });
          }
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in rate limit command:', error);
      await interaction.reply({ 
        content: '❌ Failed to execute rate limit command.', 
        ephemeral: true 
      });
    }
  }
};

// Metrics monitoring command
export const metricsCommand: SlashCommand = {
  data: {
    name: 'irc-metrics',
    description: 'View detailed IRC bridge metrics and statistics',
    defaultMemberPermissions: Permissions.FLAGS.ADMINISTRATOR,
    options: [
      {
        type: 'SUB_COMMAND',
        name: 'summary',
        description: 'Show metrics summary'
      },
      {
        type: 'SUB_COMMAND',
        name: 'detailed',
        description: 'Show detailed metrics breakdown'
      },
      {
        type: 'SUB_COMMAND',
        name: 'recent',
        description: 'Show recent activity (last hour)'
      },
      {
        type: 'SUB_COMMAND',
        name: 'export',
        description: 'Export metrics in Prometheus format'
      },
      {
        type: 'SUB_COMMAND',
        name: 'reset',
        description: 'Reset all metrics (admin only)'
      }
    ]
  },
  async execute(interaction: CommandInteraction, bot: Bot) {
    // Admin permission check
    if (!interaction.memberPermissions?.has(Permissions.FLAGS.ADMINISTRATOR)) {
      await interaction.reply({ 
        content: '❌ You need Administrator permissions to use this command.', 
        ephemeral: true 
      });
      return;
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'summary': {
          const summary = bot.metrics.getSummary();
          const embed = new MessageEmbed()
            .setTitle('📊 IRC Bridge Metrics Summary')
            .setColor('#3498db')
            .addField('📨 Total Messages', `${summary.totalMessages}`, true)
            .addField('⏱️ Messages/Hour', `${summary.messagesPerHour.toFixed(1)}`, true)
            .addField('👥 Unique Users', `${summary.uniqueUsers}`, true)
            .addField('❌ Error Rate', `${summary.errorRate.toFixed(2)}%`, true)
            .addField('🚀 Avg Latency', `${summary.averageLatency.toFixed(0)}ms`, true)
            .addField('⏰ Uptime', `${Math.floor(summary.uptime / (1000 * 60 * 60))}h`, true)
            .setTimestamp();

          if (summary.topChannels.length > 0) {
            const channelList = summary.topChannels.slice(0, 5)
              .map(ch => `**${ch.channel}**: ${ch.messages}`)
              .join('\n');
            embed.addField('🔥 Top Channels', channelList, true);
          }

          if (summary.topUsers.length > 0) {
            const userList = summary.topUsers.slice(0, 5)
              .map(u => {
                const displayName = u.user.startsWith('irc:') ? u.user.slice(4) + ' (IRC)' : u.user + ' (Discord)';
                return `**${displayName}**: ${u.messages}`;
              })
              .join('\n');
            embed.addField('👑 Top Users', userList, true);
          }

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'detailed': {
          const detailed = bot.metrics.getDetailedMetrics();
          const embed = new MessageEmbed()
            .setTitle('📈 Detailed IRC Bridge Metrics')
            .setColor('#9b59b6')
            .addField('Discord → IRC', `${detailed.messagesDiscordToIRC}`, true)
            .addField('IRC → Discord', `${detailed.messagesIRCToDiscord}`, true)
            .addField('Commands Processed', `${detailed.commandsProcessed}`, true)
            .addField('Attachments Sent', `${detailed.attachmentsSent}`, true)
            .addField('Edits Processed', `${detailed.editsProcessed}`, true)
            .addField('Deletes Processed', `${detailed.deletesProcessed}`, true)
            .addField('Messages Blocked', `${detailed.messagesBlocked}`, true)
            .addField('Users Warned', `${detailed.usersWarned}`, true)
            .addField('Users Blocked', `${detailed.usersBlocked}`, true)
            .addField('Spam Detected', `${detailed.spamDetected}`, true)
            .addField('Connection Errors', `${detailed.connectionErrors}`, true)
            .addField('Webhook Errors', `${detailed.webhookErrors}`, true)
            .addField('PM Threads Created', `${detailed.pmThreadsCreated}`, true)
            .addField('PM Messages', `${detailed.pmMessagesExchanged}`, true)
            .addField('Peak Concurrent Users', `${detailed.peakConcurrentUsers}`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'recent': {
          const recent = bot.metrics.getRecentActivity();
          const embed = new MessageEmbed()
            .setTitle('🕐 Recent Activity (Last Hour)')
            .setColor('#e67e22')
            .addField('Messages', `${recent.messagesLastHour}`, true)
            .addField('Errors', `${recent.errorsLastHour}`, true)
            .addField('Avg Latency', `${recent.averageLatencyLastHour.toFixed(0)}ms`, true)
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
          break;
        }

        case 'export': {
          const prometheusMetrics = bot.metrics.exportPrometheusMetrics();
          
          // Send as a file attachment since it can be long
          const buffer = Buffer.from(prometheusMetrics, 'utf8');
          const attachment = new MessageAttachment(buffer, `irc-bridge-metrics-${Date.now()}.txt`);
          
          await interaction.reply({ 
            content: '📤 **Prometheus Metrics Export**\n\nMetrics exported in Prometheus format. You can use these with monitoring systems like Grafana.',
            files: [attachment], 
            ephemeral: true 
          });
          break;
        }

        case 'reset': {
          bot.metrics.resetMetrics();
          await interaction.reply({ 
            content: '🔄 **Metrics Reset**\n\nAll metrics have been reset to zero. This action has been logged.',
            ephemeral: true 
          });
          break;
        }
      }
      
    } catch (error) {
      logger.error('Error in metrics command:', error);
      await interaction.reply({ 
        content: '❌ Failed to retrieve metrics information.', 
        ephemeral: true 
      });
    }
  }
};

// Export all commands
export const slashCommands: SlashCommand[] = [
  statusCommand,
  usersCommand,
  pmCommand,
  reconnectCommand,
  rateLimitCommand,
  metricsCommand
];

// Command registration utility
export async function registerSlashCommands(bot: Bot): Promise<void> {
  try {
    if (!bot.discord.application) {
      logger.error('Discord application not available for command registration');
      return;
    }

    const commandData = slashCommands.map(command => command.data);
    
    await bot.discord.application.commands.set(commandData);
    logger.info(`Successfully registered ${slashCommands.length} slash commands`);
    
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}

// Command handler
export async function handleSlashCommand(interaction: CommandInteraction, bot: Bot): Promise<void> {
  const command = slashCommands.find(cmd => cmd.data.name === interaction.commandName);
  
  if (!command) {
    await interaction.reply({ 
      content: '❌ Unknown command.', 
      ephemeral: true 
    });
    return;
  }

  try {
    await command.execute(interaction, bot);
    
    // Record slash command metrics
    bot.metrics.recordCommand(true);
    
  } catch (error) {
    logger.error(`Error executing slash command ${interaction.commandName}:`, error);
    
    const errorMessage = '❌ There was an error executing this command.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
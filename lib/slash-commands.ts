import { 
  CommandInteraction, 
  Permissions,
  MessageEmbed,
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

// Export all commands
export const slashCommands: SlashCommand[] = [
  statusCommand,
  usersCommand,
  pmCommand,
  reconnectCommand
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
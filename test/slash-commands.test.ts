import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashCommands, statusCommand, usersCommand } from '../lib/slash-commands';

describe('Slash Commands', () => {
  it('should export correct number of commands', () => {
    expect(slashCommands).toHaveLength(4);
  });

  it('should have proper command data structure', () => {
    expect(statusCommand.data.name).toBe('irc-status');
    expect((statusCommand.data as any).description).toBe('Show IRC bridge status and statistics');
    expect(typeof statusCommand.execute).toBe('function');
  });

  it('should have users command with proper options', () => {
    expect(usersCommand.data.name).toBe('irc-users');
    expect((usersCommand.data as any).options).toBeDefined();
    expect((usersCommand.data as any).options).toHaveLength(1);
    expect((usersCommand.data as any).options![0].name).toBe('channel');
  });

  it('should have all commands with admin permissions', () => {
    for (const command of slashCommands) {
      expect(command.data.defaultMemberPermissions).toBeDefined();
    }
  });
});
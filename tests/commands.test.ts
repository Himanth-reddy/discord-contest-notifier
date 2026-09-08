import { describe, it, expect, vi } from 'vitest';
import {
  SLASH_COMMANDS,
  registerSlashCommands,
  clearGuildSlashCommands,
} from '../src/discord/commands.js';

describe('Discord Slash Commands', () => {
  it('should define public commands and admin commands with permissions', () => {
    const commandNames = SLASH_COMMANDS.map((c) => c.name);
    expect(commandNames).toContain('today');
    expect(commandNames).toContain('upcoming');
    expect(commandNames).toContain('help');
    expect(commandNames).toContain('sync');
    expect(commandNames).toContain('config');

    // Verify admin commands have permission restrictions
    const syncCmd = SLASH_COMMANDS.find((c) => c.name === 'sync');
    expect(syncCmd?.default_member_permissions).toBeDefined();

    const configCmd = SLASH_COMMANDS.find((c) => c.name === 'config');
    expect(configCmd?.default_member_permissions).toBeDefined();
    expect(configCmd?.options?.length).toBe(7); // view, platforms, platform, timezone, channels, role, test
    const subNames = configCmd?.options?.map((o) => o.name);
    expect(subNames).toContain('role');
    expect(subNames).toContain('test');
  });

  it('should register slash commands via Discord API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => SLASH_COMMANDS,
    });

    global.fetch = mockFetch;

    const success = await registerSlashCommands({
      applicationId: 'app-123',
      botToken: 'bot-token-xyz',
    });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/app-123/commands',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bot bot-token-xyz',
        },
      })
    );
  });

  it('should clear guild-specific slash commands to avoid duplicates', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    global.fetch = mockFetch;

    const success = await clearGuildSlashCommands({
      applicationId: 'app-123',
      botToken: 'bot-token-xyz',
      guildId: 'guild-456',
    });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/app-123/guilds/guild-456/commands',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bot bot-token-xyz',
        },
        body: JSON.stringify([]),
      })
    );
  });
});

import { config } from '../config.js';
import { ALL_PLATFORMS } from '../contests/types.js';
import { logger } from '../utils/logger.js';

// Discord slash command choices limit is 25 items
const platformChoices = ALL_PLATFORMS.map((p) => ({
  name: p.name,
  value: p.id,
}));

export const SLASH_COMMANDS = [
  {
    name: 'today',
    description: "View today's competitive programming contests",
  },
  {
    name: 'upcoming',
    description: 'View upcoming contests for the next 7 days',
    options: [
      {
        name: 'platform',
        description: 'Filter by platform',
        type: 3, // STRING
        required: false,
        choices: platformChoices,
      },
    ],
  },
  {
    name: 'help',
    description: 'Learn about Discord Contest Notifier and available commands',
  },
  {
    name: 'sync',
    description: '[Admin] Trigger an immediate contest synchronization from CLIST',
    default_member_permissions: '32', // MANAGE_GUILD
  },
  {
    name: 'config',
    description: '[Admin] Configure channels, timezone, and platform subscriptions',
    default_member_permissions: '32', // MANAGE_GUILD
    options: [
      {
        name: 'view',
        description: 'View current server configuration and enabled platforms',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'platforms',
        description: 'Open an interactive menu to choose which contest platforms to track',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'platform',
        description: 'Enable or disable alerts for a specific platform',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'name',
            description: 'Platform name',
            type: 3, // STRING
            required: true,
            choices: platformChoices,
          },
          {
            name: 'enabled',
            description: 'Enable or disable this platform',
            type: 5, // BOOLEAN
            required: true,
          },
        ],
      },
      {
        name: 'timezone',
        description: 'Set your server timezone for digests and alerts',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'timezone',
            description: 'IANA Timezone name (e.g. Asia/Kolkata, America/New_York, UTC)',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'channels',
        description: 'Set channels for contest notifications and digests',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'started',
            description: 'Channel for live contest-start notifications',
            type: 7, // CHANNEL
            required: false,
          },
          {
            name: 'daily',
            description: 'Channel for daily contest digests',
            type: 7, // CHANNEL
            required: false,
          },
          {
            name: 'weekly',
            description: 'Channel for weekly contest digests',
            type: 7, // CHANNEL
            required: false,
          },
        ],
      },
      {
        name: 'role',
        description: 'Set or clear the role to ping for contest alerts (@Contestants)',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'role',
            description: 'The role to mention (leave empty to clear role ping)',
            type: 8, // ROLE
            required: false,
          },
        ],
      },
      {
        name: 'test',
        description: 'Send test notifications to your configured channels to verify permissions',
        type: 1, // SUB_COMMAND
      },
    ],
  },
];

/**
 * Registers slash commands with Discord REST API.
 * If guildId is provided, registers to the guild for INSTANT updates.
 * Otherwise registers globally.
 */
export async function registerSlashCommands(options?: {
  applicationId?: string;
  botToken?: string;
  guildId?: string;
}): Promise<boolean> {
  const appId = options?.applicationId || config.discord.applicationId;
  const token = options?.botToken || config.discord.botToken;
  const guildId = options?.guildId;

  if (!appId || !token) {
    throw new Error('Cannot register commands: DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
  }

  const url = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  logger.info(`Registering ${SLASH_COMMANDS.length} slash commands at ${url}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(SLASH_COMMANDS),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error(`Failed to register slash commands [${response.status}]`, errText);
    throw new Error(`Discord API error [${response.status}]: ${errText}`);
  }

  const result = await response.json();
  logger.info(`Successfully registered ${(result as any[]).length} slash commands!`);
  return true;
}

/**
 * Clears guild-specific slash commands so that only global commands exist (eliminates duplicates).
 */
export async function clearGuildSlashCommands(options: {
  applicationId?: string;
  botToken?: string;
  guildId: string;
}): Promise<boolean> {
  const appId = options.applicationId || config.discord.applicationId;
  const token = options.botToken || config.discord.botToken;

  if (!appId || !token) {
    throw new Error('Cannot clear commands: DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
  }

  const url = `https://discord.com/api/v10/applications/${appId}/guilds/${options.guildId}/commands`;
  logger.info(`Clearing guild slash commands at ${url}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify([]),
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error(`Failed to clear guild slash commands [${response.status}]`, errText);
    throw new Error(`Discord API error [${response.status}]: ${errText}`);
  }

  logger.info(`Successfully cleared guild slash commands for guild ${options.guildId}`);
  return true;
}

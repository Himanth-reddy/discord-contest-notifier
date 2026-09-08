import { config } from '../config.js';
import { logger } from '../utils/logger.js';

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
        choices: [
          { name: 'Codeforces', value: 'codeforces' },
          { name: 'LeetCode', value: 'leetcode' },
          { name: 'AtCoder', value: 'atcoder' },
          { name: 'CodeChef', value: 'codechef' },
        ],
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
        description: 'View current server configuration',
        type: 1, // SUB_COMMAND
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
        name: 'platform',
        description: 'Enable or disable alerts for a specific platform',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'name',
            description: 'Platform name',
            type: 3, // STRING
            required: true,
            choices: [
              { name: 'Codeforces', value: 'codeforces' },
              { name: 'LeetCode', value: 'leetcode' },
              { name: 'AtCoder', value: 'atcoder' },
              { name: 'CodeChef', value: 'codechef' },
            ],
          },
          {
            name: 'enabled',
            description: 'Enable or disable this platform',
            type: 5, // BOOLEAN
            required: true,
          },
        ],
      },
    ],
  },
];

/**
 * Registers slash commands with Discord REST API globally.
 */
export async function registerSlashCommands(options?: {
  applicationId?: string;
  botToken?: string;
}): Promise<boolean> {
  const appId = options?.applicationId || config.discord.applicationId;
  const token = options?.botToken || config.discord.botToken;

  if (!appId || !token) {
    throw new Error('Cannot register commands: DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
  }

  const url = `https://discord.com/api/v10/applications/${appId}/commands`;
  logger.info(`Registering ${SLASH_COMMANDS.length} slash commands globally at ${url}`);

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

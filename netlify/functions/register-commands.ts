import { Handler } from '@netlify/functions';
import {
  registerSlashCommands,
  clearGuildSlashCommands,
  SLASH_COMMANDS,
} from '../../src/discord/commands.js';
import { runMigrations } from '../../src/database/migrate.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async (event) => {
  logger.info('Registering/cleaning slash commands with Discord API');
  try {
    const guildId = event.queryStringParameters?.guildId || '1546470499385741312';
    const mode = event.queryStringParameters?.mode || 'clean';

    // Ensure database tables and seeded platforms exist
    await runMigrations();

    if (mode === 'clean') {
      // 1. Register globally
      await registerSlashCommands();
      // 2. Clear guild-specific commands so they don't show up twice in the server
      if (guildId) {
        await clearGuildSlashCommands({ guildId });
      }
    } else if (mode === 'guild-only') {
      await registerSlashCommands({ guildId });
    } else if (mode === 'global-only') {
      await registerSlashCommands();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Successfully updated slash commands without duplicates!',
        guildId,
        mode,
        commands: SLASH_COMMANDS.map((c) => `/${c.name}`),
      }),
    };
  } catch (err: any) {
    logger.error('Failed to register slash commands', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err.message || 'Failed to register slash commands',
      }),
    };
  }
};

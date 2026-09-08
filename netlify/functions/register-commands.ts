import { Handler } from '@netlify/functions';
import { registerSlashCommands, SLASH_COMMANDS } from '../../src/discord/commands.js';
import { runMigrations } from '../../src/database/migrate.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async (event) => {
  logger.info('Registering slash commands with Discord API');
  try {
    const guildId = event.queryStringParameters?.guildId || '1546470499385741312';

    // Ensure database tables and seeded platforms exist
    await runMigrations();

    // Register to specific guild for INSTANT (0-second) cache update
    await registerSlashCommands({ guildId });

    // Also register globally
    await registerSlashCommands();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Successfully registered slash commands globally and to server!',
        guildId,
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

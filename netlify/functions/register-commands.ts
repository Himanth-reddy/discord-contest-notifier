import { Handler } from '@netlify/functions';
import { registerSlashCommands, SLASH_COMMANDS } from '../../src/discord/commands.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async () => {
  logger.info('Registering slash commands with Discord API');
  try {
    await registerSlashCommands();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Successfully registered slash commands with Discord!',
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

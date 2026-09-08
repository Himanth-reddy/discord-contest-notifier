import { Handler, schedule } from '@netlify/functions';
import { ContestService } from '../../src/contests/service.js';
import { runMigrations } from '../../src/database/migrate.js';
import { logger } from '../../src/utils/logger.js';

const syncContestsHandler: Handler = async () => {
  logger.info('Starting Contest Synchronization from CLIST');
  try {
    await runMigrations();

    const service = new ContestService();
    const summary = await service.syncContests();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Contest synchronization successful',
        ...summary,
      }),
    };
  } catch (err: any) {
    logger.error('Error during contest synchronization', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Contest sync failed' }),
    };
  }
};

// Schedule: Every 2 hours
export const handler = schedule('0 */2 * * *', syncContestsHandler);

import { Handler } from '@netlify/functions';
import { ContestService } from '../../src/contests/service.js';
import { runMigrations } from '../../src/database/migrate.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async () => {
  logger.info('Manual trigger: Contest Synchronization from CLIST');
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
    logger.error('Error during manual contest synchronization', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Contest sync failed' }),
    };
  }
};

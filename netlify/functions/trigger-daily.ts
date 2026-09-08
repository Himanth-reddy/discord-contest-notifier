import { Handler } from '@netlify/functions';
import { executeDailyDigest } from '../../src/digests/daily.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async () => {
  logger.info('Manual trigger: Daily Digest');
  try {
    const result = await executeDailyDigest();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Daily digest executed successfully',
        ...result,
      }),
    };
  } catch (err: any) {
    logger.error('Error during manual daily digest', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Daily digest failed' }),
    };
  }
};

import { Handler, schedule } from '@netlify/functions';
import { executeDailyDigest } from '../../src/digests/daily.js';
import { logger } from '../../src/utils/logger.js';

const dailyDigestHandler: Handler = async () => {
  logger.info('Starting scheduled Daily Digest execution');
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
    logger.error('Error during daily digest execution', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Daily digest failed' }),
    };
  }
};

// Schedule: Daily at 00:00 UTC
export const handler = schedule('0 0 * * *', dailyDigestHandler);

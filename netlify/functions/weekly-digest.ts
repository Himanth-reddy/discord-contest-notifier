import { Handler, schedule } from '@netlify/functions';
import { executeWeeklyDigest } from '../../src/digests/weekly.js';
import { logger } from '../../src/utils/logger.js';

const weeklyDigestHandler: Handler = async () => {
  logger.info('Starting scheduled Weekly Digest execution');
  try {
    const result = await executeWeeklyDigest();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Weekly digest executed successfully',
        ...result,
      }),
    };
  } catch (err: any) {
    logger.error('Error during weekly digest execution', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Weekly digest failed' }),
    };
  }
};

// Schedule: Weekly on Monday at 00:00 UTC
export const handler = schedule('0 0 * * 1', weeklyDigestHandler);

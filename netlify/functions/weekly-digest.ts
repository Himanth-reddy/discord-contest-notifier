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

// Schedule: Every hour (checks local Monday morning digest hour for each server timezone)
export const handler = schedule('0 * * * *', weeklyDigestHandler);

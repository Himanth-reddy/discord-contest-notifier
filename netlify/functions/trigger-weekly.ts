import { Handler } from '@netlify/functions';
import { executeWeeklyDigest } from '../../src/digests/weekly.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async () => {
  logger.info('Manual trigger: Weekly Digest');
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
    logger.error('Error during manual weekly digest', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Weekly digest failed' }),
    };
  }
};

import { Handler } from '@netlify/functions';
import { executeContestStartNotification } from '../../src/notifications/contest-start.js';
import { logger } from '../../src/utils/logger.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const contestId = body.contestId;

    if (!contestId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing contestId in request body' }),
      };
    }

    logger.info(`Manual notification trigger requested for contest: ${contestId}`);
    const result = await executeContestStartNotification(contestId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    logger.error('Manual notification failed', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Notification failed' }),
    };
  }
};

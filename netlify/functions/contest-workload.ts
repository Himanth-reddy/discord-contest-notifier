import { asyncWorkloadFn, AsyncWorkloadConfig, AsyncWorkloadEvent } from '@netlify/async-workloads';
import { executeContestStartNotification } from '../../src/notifications/contest-start.js';
import { CONTEST_START_EVENT, ContestStartEventData } from '../../src/notifications/types.js';
import { logger } from '../../src/utils/logger.js';

export default asyncWorkloadFn(
  async ({ eventData, step }: AsyncWorkloadEvent<{ eventName: typeof CONTEST_START_EVENT; eventData: ContestStartEventData }>) => {
    const { contestId, scheduledStartTime } = eventData || {};

    if (!contestId) {
      logger.warn('Workload received event without contestId. Exiting.');
      return;
    }

    // Step 1: Calculate delay needed until scheduled contest start time
    const now = Date.now();
    const targetTime = scheduledStartTime ? new Date(scheduledStartTime).getTime() : now;
    const delayMs = targetTime - now;

    // Use durable step.sleep if start time is in the future
    if (delayMs > 5000) {
      const sleepSeconds = Math.ceil(delayMs / 1000);
      logger.info(`Async Workload sleeping durably for ${sleepSeconds}s until contest start (${contestId})`);
      await step.sleep('wait-for-contest-start', `${sleepSeconds}s`);
    }

    // Step 2: Validate current state in DB, check idempotency, and dispatch notification
    const result = await step.run('validate-and-dispatch-notification', async () => {
      logger.info(`Async Workload executing notification check for contest ${contestId}`);
      return await executeContestStartNotification(contestId);
    });

    logger.info(`Async Workload completed for contest ${contestId}`, result);
  }
);

export const asyncWorkloadConfig: AsyncWorkloadConfig = {
  name: 'contest-start-workload',
  events: [CONTEST_START_EVENT],
  maxRetries: 3,
};

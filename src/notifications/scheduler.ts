import { AsyncWorkloadsClient } from '@netlify/async-workloads';
import { ContestRepository } from '../contests/repository.js';
import { Contest } from '../contests/types.js';
import { logger } from '../utils/logger.js';
import { CONTEST_START_EVENT, ContestStartEventData, WorkloadDispatcher } from './types.js';

export class NotificationScheduler {
  private repo: ContestRepository;
  private dispatcher: WorkloadDispatcher;

  constructor(repo?: ContestRepository, dispatcher?: WorkloadDispatcher) {
    this.repo = repo || new ContestRepository();
    this.dispatcher = dispatcher || (new AsyncWorkloadsClient() as unknown as WorkloadDispatcher);
  }

  /**
   * Schedules a contest start notification.
   * Records it in contest_notifications and triggers the durable Netlify Async Workload.
   */
  async scheduleContestStart(contest: Contest, now: Date = new Date()): Promise<void> {
    const existing = await this.repo.getNotification(contest.id, 'CONTEST_STARTED');

    // If already sent, do not re-schedule
    if (existing?.sentAt) {
      logger.info(`Notification for contest ${contest.id} (${contest.name}) already sent at ${existing.sentAt.toISOString()}`);
      return;
    }

    // If contest has already ended, do not schedule
    if (contest.endTime && contest.endTime.getTime() <= now.getTime()) {
      logger.info(`Contest ${contest.id} (${contest.name}) has already ended. Skipping notification scheduling.`);
      return;
    }

    // Upsert into database
    await this.repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');

    // Dispatch Netlify Async Workload event
    const eventPayload: ContestStartEventData = {
      contestId: contest.id,
      scheduledStartTime: contest.startTime.toISOString(),
    };

    try {
      await this.dispatcher.send(CONTEST_START_EVENT, {
        data: eventPayload,
        delayUntil: contest.startTime.toISOString(),
      });
      logger.info(`Dispatched Async Workload for contest ${contest.id} (${contest.name}) starting at ${contest.startTime.toISOString()}`);
    } catch (err) {
      logger.error(`Failed to dispatch Async Workload for contest ${contest.id}`, err);
      // Even if dispatching failed transiently, it is persisted in DB and can be picked up by sync/digest
    }
  }

  /**
   * Handles rescheduling: updates the scheduled time in DB and dispatches a new workload event.
   */
  async rescheduleContestStart(contest: Contest, oldStartTime?: Date): Promise<void> {
    logger.info(
      `Contest ${contest.id} (${contest.name}) rescheduled from ${oldStartTime?.toISOString() ?? 'unknown'} to ${contest.startTime.toISOString()}`
    );

    const existing = await this.repo.getNotification(contest.id, 'CONTEST_STARTED');
    if (existing?.sentAt) {
      logger.info(`Notification for ${contest.id} was already sent previously. Not rescheduling.`);
      return;
    }

    // Update scheduled_for in DB
    await this.repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');

    // Dispatch a new workload event for the updated time
    const eventPayload: ContestStartEventData = {
      contestId: contest.id,
      scheduledStartTime: contest.startTime.toISOString(),
    };

    try {
      await this.dispatcher.send(CONTEST_START_EVENT, {
        data: eventPayload,
        delayUntil: contest.startTime.toISOString(),
      });
      logger.info(`Dispatched updated Async Workload for rescheduled contest ${contest.id}`);
    } catch (err) {
      logger.error(`Failed to dispatch updated Async Workload for rescheduled contest ${contest.id}`, err);
    }
  }
}

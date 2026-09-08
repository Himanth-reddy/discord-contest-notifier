import { Client as QStashClient } from '@upstash/qstash';
import { config } from '../config.js';
import { ContestRepository } from '../contests/repository.js';
import { Contest } from '../contests/types.js';
import { logger } from '../utils/logger.js';
import { CONTEST_START_EVENT, ContestStartEventData, WorkloadDispatcher } from './types.js';

export class NotificationScheduler {
  private repo: ContestRepository;
  private dispatcher?: WorkloadDispatcher;

  constructor(repo?: ContestRepository, dispatcher?: WorkloadDispatcher) {
    this.repo = repo || new ContestRepository();

    if (dispatcher) {
      this.dispatcher = dispatcher;
    } else {
      const qstashToken = config.qstash.token || process.env.QSTASH_TOKEN;
      const qstashUrl = config.qstash.url || process.env.QSTASH_URL || 'https://qstash.upstash.io';
      const siteUrl =
        process.env.URL ||
        process.env.DEPLOY_URL ||
        'https://discordcontestnotifier.netlify.app';

      if (qstashToken) {
        try {
          const qstash = new QStashClient({
            token: qstashToken,
            baseUrl: qstashUrl,
          });

          this.dispatcher = {
            async send(eventName: string, options?: { data?: any; delayUntil?: number | string }) {
              const contestId = options?.data?.contestId;
              const targetUrl = `${siteUrl}/.netlify/functions/notify-manual`;

              let notBefore: number | undefined;
              if (options?.delayUntil) {
                const ms =
                  typeof options.delayUntil === 'number'
                    ? options.delayUntil
                    : new Date(options.delayUntil).getTime();
                notBefore = Math.floor(ms / 1000);
              }

              const deduplicationId =
                contestId && notBefore ? `contest-start-${contestId}-${notBefore}` : undefined;

              const res = await qstash.publishJSON({
                url: targetUrl,
                body: { contestId },
                notBefore,
                deduplicationId,
              });

              return {
                sendStatus: 'SCHEDULED',
                eventId: res.messageId,
              };
            },
          };
          logger.info(`Initialized QStash dispatcher with target: ${siteUrl}`);
        } catch (err: any) {
          logger.warn(`Could not initialize QStashClient: ${err.message}`);
        }
      } else {
        logger.warn('No QSTASH_TOKEN configured. Scheduled notifications will be saved to DB only.');
      }
    }
  }

  /**
   * Schedules a contest start notification.
   * Records it in contest_notifications and triggers the durable Netlify Async Workload.
   */
  async scheduleContestStart(contest: Contest, now: Date = new Date()): Promise<void> {
    const existing = await this.repo.getNotification(contest.id, 'CONTEST_STARTED');

    // If already sent, do not re-schedule
    if (existing?.sentAt) {
      logger.info(
        `Notification for contest ${contest.id} (${contest.name}) already sent at ${existing.sentAt.toISOString()}`
      );
      return;
    }

    // If contest has already ended, do not schedule
    if (contest.endTime && contest.endTime.getTime() <= now.getTime()) {
      logger.info(
        `Contest ${contest.id} (${contest.name}) has already ended. Skipping notification scheduling.`
      );
      return;
    }

    // Upsert into database
    await this.repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');

    // Dispatch Netlify Async Workload event
    if (!this.dispatcher) {
      logger.warn(`No workload dispatcher available for contest ${contest.id}`);
      return;
    }

    const eventPayload: ContestStartEventData = {
      contestId: contest.id,
      scheduledStartTime: contest.startTime.toISOString(),
    };

    try {
      await this.dispatcher.send(CONTEST_START_EVENT, {
        data: eventPayload,
        delayUntil: contest.startTime.toISOString(),
      });
      logger.info(
        `Dispatched Async Workload for contest ${contest.id} (${contest.name}) starting at ${contest.startTime.toISOString()}`
      );
    } catch (err: any) {
      logger.warn(
        `Async Workload dispatch deferred for contest ${contest.id}: ${err.message}. Notification remains securely scheduled in database.`
      );
    }
  }

  /**
   * Handles rescheduling: updates the scheduled time in DB and dispatches a new workload event.
   */
  async rescheduleContestStart(contest: Contest, oldStartTime?: Date): Promise<void> {
    logger.info(
      `Contest ${contest.id} (${contest.name}) rescheduled from ${
        oldStartTime?.toISOString() ?? 'unknown'
      } to ${contest.startTime.toISOString()}`
    );

    const existing = await this.repo.getNotification(contest.id, 'CONTEST_STARTED');
    if (existing?.sentAt) {
      logger.info(`Notification for ${contest.id} was already sent previously. Not rescheduling.`);
      return;
    }

    // Update scheduled_for in DB
    await this.repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');

    if (!this.dispatcher) return;

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
    } catch (err: any) {
      logger.warn(
        `Could not dispatch updated Async Workload for rescheduled contest ${contest.id}: ${err.message}`
      );
    }
  }
}

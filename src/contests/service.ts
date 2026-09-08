import { ClistClient } from '../clist/client.js';
import { ContestRepository } from './repository.js';
import { ContestStatus, Contest, UpsertContestResult } from './types.js';
import { NotificationScheduler } from '../notifications/scheduler.js';
import { logger } from '../utils/logger.js';

export interface SyncContestsOptions {
  since?: Date;
  until?: Date;
  resources?: string[];
  limit?: number;
}

export interface SyncSummary {
  fetched: number;
  newContests: number;
  rescheduledContests: number;
  cancelledContests: number;
  unchangedContests: number;
  contests: Contest[];
}

export class ContestService {
  private clistClient: ClistClient;
  private repo: ContestRepository;
  private scheduler: NotificationScheduler;

  constructor(
    clistClient?: ClistClient,
    repo?: ContestRepository,
    scheduler?: NotificationScheduler
  ) {
    this.clistClient = clistClient || new ClistClient();
    this.repo = repo || new ContestRepository();
    this.scheduler = scheduler || new NotificationScheduler(this.repo);
  }

  /**
   * Synchronizes upcoming and active contests from CLIST into the local database,
   * updates status, detects reschedules, and schedules notifications.
   */
  async syncContests(options: SyncContestsOptions = {}): Promise<SyncSummary> {
    const now = new Date();
    const syncTime = now;
    // Default window: contests active now or starting in the next 14 days
    const startGte = options.since || new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startLte = options.until || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    logger.info(`Starting CLIST synchronization (window: ${startGte.toISOString()} to ${startLte.toISOString()})`);

    const normalizedList = await this.clistClient.fetchContests({
      startGte,
      startLte,
      resources: options.resources,
      limit: options.limit || 100,
    });

    logger.info(`Fetched ${normalizedList.length} contests from CLIST API`);

    let newCount = 0;
    let rescheduledCount = 0;
    let cancelledCount = 0;
    let unchangedCount = 0;
    const processedContests: Contest[] = [];

    for (const item of normalizedList) {
      // Determine initial status based on current time
      let status: ContestStatus = 'SCHEDULED';
      if (item.endTime && item.endTime.getTime() <= now.getTime()) {
        status = 'FINISHED';
      } else if (item.startTime.getTime() <= now.getTime()) {
        status = 'RUNNING';
      }

      const upsertResult = await this.repo.upsertContest(
        {
          externalId: item.externalId,
          platform: item.platform,
          name: item.name,
          url: item.url,
          startTime: item.startTime,
          endTime: item.endTime,
          duration: item.duration,
          status,
        },
        syncTime
      );

      const contest = upsertResult.contest;
      processedContests.push(contest);

      switch (upsertResult.changeType) {
        case 'NEW':
          newCount++;
          if (contest.status !== 'FINISHED') {
            await this.scheduler.scheduleContestStart(contest, now);
          }
          break;

        case 'RESCHEDULED':
          rescheduledCount++;
          await this.scheduler.rescheduleContestStart(contest, upsertResult.oldStartTime);
          break;

        case 'CANCELLED':
          cancelledCount++;
          break;

        case 'UNCHANGED':
          unchangedCount++;
          // Ensure notification is recorded in case DB was wiped or partially synced
          if (contest.status === 'SCHEDULED' || contest.status === 'RUNNING') {
            const notif = await this.repo.getNotification(contest.id, 'CONTEST_STARTED');
            if (!notif) {
              await this.scheduler.scheduleContestStart(contest, now);
            }
          }
          break;
      }
    }

    const summary: SyncSummary = {
      fetched: normalizedList.length,
      newContests: newCount,
      rescheduledContests: rescheduledCount,
      cancelledContests: cancelledCount,
      unchangedContests: unchangedCount,
      contests: processedContests,
    };

    logger.info('CLIST synchronization completed', {
      fetched: summary.fetched,
      new: summary.newContests,
      rescheduled: summary.rescheduledContests,
      unchanged: summary.unchangedContests,
    });

    return summary;
  }
}

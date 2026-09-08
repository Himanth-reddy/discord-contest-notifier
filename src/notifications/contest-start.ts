import { config } from '../config.js';
import { DEFAULT_PLATFORMS } from '../contests/types.js';
import { ContestRepository } from '../contests/repository.js';
import { DiscordClient } from '../discord/client.js';
import { logger } from '../utils/logger.js';

export type ContestNotificationResultStatus =
  | 'sent'
  | 'already_sent'
  | 'cancelled'
  | 'rescheduled'
  | 'not_found'
  | 'finished'
  | 'no_destination';

export interface ContestNotificationResult {
  status: ContestNotificationResultStatus;
  contestId: string;
  recipientsCount?: number;
}

export async function executeContestStartNotification(
  contestId: string,
  options?: {
    repo?: ContestRepository;
    discordClient?: DiscordClient;
    now?: Date;
  }
): Promise<ContestNotificationResult> {
  const repo = options?.repo || new ContestRepository();
  const discord = options?.discordClient || new DiscordClient();
  const now = options?.now || new Date();

  // 1. Reload contest from database
  const contest = await repo.findById(contestId);
  if (!contest) {
    logger.warn(`Contest ${contestId} not found in database when executing start notification`);
    return { status: 'not_found', contestId };
  }

  // 2. Validate status: Check if cancelled
  if (contest.status === 'CANCELLED') {
    logger.info(`Contest ${contestId} (${contest.name}) is CANCELLED. Skipping start notification.`);
    return { status: 'cancelled', contestId };
  }

  // 3. Check if contest has already ended
  if (contest.endTime && contest.endTime.getTime() <= now.getTime()) {
    logger.info(`Contest ${contestId} (${contest.name}) has already ended. Skipping start notification.`);
    return { status: 'finished', contestId };
  }

  // 4. Check if contest was rescheduled to a future time (more than 60s from now)
  const timeDifferenceMs = contest.startTime.getTime() - now.getTime();
  if (timeDifferenceMs > 60 * 1000) {
    logger.info(
      `Contest ${contestId} (${contest.name}) has been rescheduled to ${contest.startTime.toISOString()}. Deferring notification.`
    );
    await repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');
    return { status: 'rescheduled', contestId };
  }

  // 5. Pre-check notification status and ensure record exists
  let notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
  if (!notif) {
    notif = await repo.scheduleNotification(contest.id, contest.startTime, 'CONTEST_STARTED');
  } else if (notif.sentAt) {
    logger.info(`Notification for contest ${contestId} already sent at ${notif.sentAt.toISOString()}. Aborting duplicate.`);
    return { status: 'already_sent', contestId };
  }

  // 6. Idempotency atomic claim in database
  const claimed = await repo.claimAndMarkNotificationSent(contest.id, now, 'CONTEST_STARTED');
  if (!claimed) {
    logger.info(`Notification for contest ${contestId} was claimed/sent by another worker. Exiting.`);
    return { status: 'already_sent', contestId };
  }

  // 7. Determine destinations and deliver
  let recipientsCount = 0;
  const servers = await repo.getAllServers();

  if (servers.length > 0) {
    for (const server of servers) {
      if (!server.startedChannelId && !server.webhookUrl) {
        continue;
      }

      // Check server platform filter (defaults to CodeChef, Codeforces, LeetCode)
      const enabledPlatforms = await repo.getServerEnabledPlatforms(server.guildId);
      const isPlatformEnabled = enabledPlatforms.includes(contest.platform.toLowerCase());

      if (!isPlatformEnabled) {
        logger.debug(`Server ${server.guildId} has filtered out platform ${contest.platform}`);
        continue;
      }

      try {
        const sent = await discord.sendContestStarted(contest, {
          channelId: server.startedChannelId,
          webhookUrl: server.webhookUrl,
          timezone: server.timezone,
        });
        if (sent) recipientsCount++;
      } catch (err) {
        logger.error(`Failed to send contest start notification to server ${server.guildId}`, err);
      }
    }
  } else {
    // Single-server fallback from environment
    const defaultChannel = config.discord.defaultStartedChannelId;
    const defaultWebhook = config.discord.defaultWebhookUrl;
    const isPlatformDefault = DEFAULT_PLATFORMS.includes(contest.platform.toLowerCase());

    if ((defaultChannel || defaultWebhook) && isPlatformDefault) {
      try {
        const sent = await discord.sendContestStarted(contest, {
          channelId: defaultChannel,
          webhookUrl: defaultWebhook,
          timezone: config.defaultTimezone,
        });
        if (sent) recipientsCount++;
      } catch (err) {
        logger.error('Failed to send contest start notification to default channel/webhook', err);
      }
    } else {
      logger.warn(`No Discord server subscribed or platform ${contest.platform} not enabled by default.`);
    }
  }

  // 8. Update contest status to RUNNING if it was SCHEDULED
  if (contest.status === 'SCHEDULED') {
    await repo.upsertContest(
      {
        ...contest,
        status: 'RUNNING',
      },
      now
    );
  }

  logger.info(`Contest start notification completed for ${contest.name} (recipients: ${recipientsCount})`);
  return {
    status: recipientsCount > 0 ? 'sent' : 'no_destination',
    contestId,
    recipientsCount,
  };
}

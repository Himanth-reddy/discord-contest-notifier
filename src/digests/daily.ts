import { config } from '../config.js';
import { DEFAULT_PLATFORMS } from '../contests/types.js';
import { ContestRepository } from '../contests/repository.js';
import { DiscordClient } from '../discord/client.js';
import { NotificationScheduler } from '../notifications/scheduler.js';
import { logger } from '../utils/logger.js';
import { getServerDayBounds } from '../utils/timezone.js';

export interface DigestExecutionResult {
  serversProcessed: number;
  digestsSent: number;
}

export async function executeDailyDigest(options?: {
  repo?: ContestRepository;
  discord?: DiscordClient;
  scheduler?: NotificationScheduler;
  now?: Date;
}): Promise<DigestExecutionResult> {
  const repo = options?.repo || new ContestRepository();
  const discord = options?.discord || new DiscordClient();
  const scheduler = options?.scheduler || new NotificationScheduler(repo);
  const now = options?.now || new Date();

  const servers = await repo.getAllServers();
  let digestsSent = 0;
  let serversProcessed = 0;

  if (servers.length > 0) {
    for (const server of servers) {
      if (!server.dailyChannelId && !server.webhookUrl) {
        continue;
      }
      serversProcessed++;

      const tz = server.timezone || config.defaultTimezone;
      const { startUtc, endUtc } = getServerDayBounds(now, tz);

      // Check server platform preferences (defaults to Codeforces, CodeChef, LeetCode)
      const enabledPlatforms = await repo.getServerEnabledPlatforms(server.guildId);
      const contests = await repo.findContestsInWindow(startUtc, endUtc, enabledPlatforms);

      // Ensure start notifications are scheduled for these contests
      for (const contest of contests) {
        if (contest.status === 'SCHEDULED') {
          await scheduler.scheduleContestStart(contest, now);
        }
      }

      try {
        const sent = await discord.sendDailyDigest(contests, {
          channelId: server.dailyChannelId,
          webhookUrl: server.webhookUrl,
          timezone: tz,
        });
        if (sent) digestsSent++;
      } catch (err) {
        logger.error(`Failed to send daily digest to server ${server.guildId}`, err);
      }
    }
  } else {
    // Single-server fallback
    const channelId = config.discord.defaultDailyChannelId;
    const webhookUrl = config.discord.defaultWebhookUrl;

    if (channelId || webhookUrl) {
      serversProcessed = 1;
      const tz = config.defaultTimezone;
      const { startUtc, endUtc } = getServerDayBounds(now, tz);
      const contests = await repo.findContestsInWindow(startUtc, endUtc, DEFAULT_PLATFORMS);

      for (const contest of contests) {
        if (contest.status === 'SCHEDULED') {
          await scheduler.scheduleContestStart(contest, now);
        }
      }

      try {
        const sent = await discord.sendDailyDigest(contests, {
          channelId,
          webhookUrl,
          timezone: tz,
        });
        if (sent) digestsSent++;
      } catch (err) {
        logger.error('Failed to send daily digest to default destination', err);
      }
    } else {
      logger.warn('No Discord servers configured and no default daily channel/webhook defined');
    }
  }

  logger.info(`Daily digest execution finished: ${digestsSent} sent across ${serversProcessed} servers`);
  return { serversProcessed, digestsSent };
}

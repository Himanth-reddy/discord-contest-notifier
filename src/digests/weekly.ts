import { config } from '../config.js';
import { DEFAULT_PLATFORMS } from '../contests/types.js';
import { ContestRepository } from '../contests/repository.js';
import { DiscordClient } from '../discord/client.js';
import { logger } from '../utils/logger.js';
import { getServerWeekBounds, isServerWeeklyDigestDue } from '../utils/timezone.js';
import { DailyDigestResult } from './daily.js';

export interface WeeklyDigestOptions {
  repo?: ContestRepository;
  discord?: DiscordClient;
  now?: Date;
  force?: boolean;
}

export async function executeWeeklyDigest(options?: WeeklyDigestOptions): Promise<DailyDigestResult> {
  const repo = options?.repo || new ContestRepository();
  const discord = options?.discord || new DiscordClient();
  const now = options?.now || new Date();

  const servers = await repo.getAllServers();
  let digestsSent = 0;
  let serversProcessed = 0;

  if (servers.length > 0) {
    for (const server of servers) {
      if (!server.weeklyChannelId && !server.webhookUrl) {
        continue;
      }

      const tz = server.timezone || config.defaultTimezone;
      const targetHour = 7; // 7:00 AM local time on Monday

      if (!options?.force) {
        const isDue = isServerWeeklyDigestDue(tz, server.lastWeeklyDigestAt, targetHour, 1, now);
        if (!isDue) {
          logger.debug(`Weekly digest not due for server ${server.guildId} (tz: ${tz})`);
          continue;
        }
      }

      serversProcessed++;

      const { startUtc, endUtc } = getServerWeekBounds(now, tz);

      // Check server platform preferences (defaults to Codeforces, CodeChef, LeetCode)
      const enabledPlatforms = await repo.getServerEnabledPlatforms(server.guildId);
      const contests = await repo.findContestsInWindow(startUtc, endUtc, enabledPlatforms);

      try {
        const sent = await discord.sendWeeklyDigest(contests, {
          channelId: server.weeklyChannelId,
          webhookUrl: server.webhookUrl,
          timezone: tz,
          alertRoleId: server.alertRoleId,
        });
        if (sent) {
          digestsSent++;
          await repo.updateServerDigestTimestamp(server.guildId, 'weekly', now);
        }
      } catch (err) {
        logger.error(`Failed to send weekly digest to server ${server.guildId}`, err);
      }
    }
  } else {
    // Single-server fallback
    const channelId = config.discord.defaultWeeklyChannelId;
    const webhookUrl = config.discord.defaultWebhookUrl;

    if (channelId || webhookUrl) {
      serversProcessed = 1;
      const tz = config.defaultTimezone;
      const { startUtc, endUtc } = getServerWeekBounds(now, tz);
      const contests = await repo.findContestsInWindow(startUtc, endUtc, DEFAULT_PLATFORMS);

      try {
        const sent = await discord.sendWeeklyDigest(contests, {
          channelId,
          webhookUrl,
          timezone: tz,
        });
        if (sent) digestsSent++;
      } catch (err) {
        logger.error('Failed to send weekly digest to default destination', err);
      }
    } else {
      logger.warn('No Discord servers configured and no default weekly channel/webhook defined');
    }
  }

  logger.info(`Weekly digest execution finished: ${digestsSent} sent across ${serversProcessed} servers`);
  return { serversProcessed, digestsSent };
}

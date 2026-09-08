import { config } from '../config.js';
import { ContestRepository } from '../contests/repository.js';
import { DiscordClient } from '../discord/client.js';
import { logger } from '../utils/logger.js';
import { getServerWeekBounds } from '../utils/timezone.js';
import { DigestExecutionResult } from './daily.js';

export async function executeWeeklyDigest(options?: {
  repo?: ContestRepository;
  discord?: DiscordClient;
  now?: Date;
}): Promise<DigestExecutionResult> {
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
      serversProcessed++;

      const tz = server.timezone || config.defaultTimezone;
      const { startUtc, endUtc } = getServerWeekBounds(now, tz);

      const enabledPlatforms = await repo.getServerEnabledPlatforms(server.guildId);
      const platformsFilter = enabledPlatforms.length > 0 ? enabledPlatforms : undefined;

      const contests = await repo.findContestsInWindow(startUtc, endUtc, platformsFilter);

      try {
        const sent = await discord.sendWeeklyDigest(contests, {
          channelId: server.weeklyChannelId,
          webhookUrl: server.webhookUrl,
          timezone: tz,
        });
        if (sent) digestsSent++;
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
      const contests = await repo.findContestsInWindow(startUtc, endUtc);

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

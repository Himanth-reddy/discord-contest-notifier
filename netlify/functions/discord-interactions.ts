import { Handler } from '@netlify/functions';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { config } from '../../src/config.js';
import { ContestRepository } from '../../src/contests/repository.js';
import { ContestService } from '../../src/contests/service.js';
import {
  formatDailyDigestMessage,
  formatWeeklyDigestMessage,
} from '../../src/discord/formatter.js';
import { logger } from '../../src/utils/logger.js';
import { getServerDayBounds, getServerWeekBounds } from '../../src/utils/timezone.js';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature =
    event.headers['x-signature-ed25519'] ||
    event.headers['X-Signature-Ed25519'] ||
    '';
  const timestamp =
    event.headers['x-signature-timestamp'] ||
    event.headers['X-Signature-Timestamp'] ||
    '';

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf-8')
    : (event.body || '');

  // 1. Check Public Key
  const publicKey = config.discord.publicKey;
  if (!publicKey) {
    logger.warn('DISCORD_PUBLIC_KEY is not set in environment variables');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: DISCORD_PUBLIC_KEY missing' }),
    };
  }

  // 2. Verify Discord cryptographic signature
  const isValidRequest = verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValidRequest) {
    logger.warn('Received invalid Discord interaction signature');
    return { statusCode: 401, body: 'Invalid request signature' };
  }

  const interaction = JSON.parse(rawBody);

  // 3. Respond to Discord PING (required for endpoint validation)
  if (interaction.type === InteractionType.PING) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: InteractionResponseType.PONG }),
    };
  }

  // 4. Handle Application Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = interaction.data;
    const guildId = interaction.guild_id || 'default';
    const repo = new ContestRepository();
    const server = await repo.getServer(guildId);
    const timezone = server?.timezone || config.defaultTimezone;
    const now = new Date();

    logger.info(`Received slash command: /${name} from guild: ${guildId}`);

    // Command: /today
    if (name === 'today') {
      const { startUtc, endUtc } = getServerDayBounds(now, timezone);
      const enabledPlatforms = await repo.getServerEnabledPlatforms(guildId);
      const platformsFilter = enabledPlatforms.length > 0 ? enabledPlatforms : undefined;

      const contests = await repo.findContestsInWindow(startUtc, endUtc, platformsFilter);
      const payload = formatDailyDigestMessage(contests, timezone);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: payload,
        }),
      };
    }

    // Command: /upcoming
    if (name === 'upcoming') {
      const platformOption = options?.find((o: any) => o.name === 'platform')?.value;
      const { startUtc, endUtc } = getServerWeekBounds(now, timezone);

      let platformsFilter: string[] | undefined;
      if (platformOption) {
        platformsFilter = [platformOption.toLowerCase()];
      } else {
        const enabled = await repo.getServerEnabledPlatforms(guildId);
        if (enabled.length > 0) platformsFilter = enabled;
      }

      const contests = await repo.findContestsInWindow(startUtc, endUtc, platformsFilter);
      const payload = formatWeeklyDigestMessage(contests, timezone);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: payload,
        }),
      };
    }

    // Command: /help
    if (name === 'help') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [
              {
                title: '🏆 Discord Contest Notifier Help',
                description:
                  'A serverless bot that automatically notifies your server about competitive programming contests from Codeforces, LeetCode, AtCoder, CodeChef, and more.',
                color: 0x5865f2,
                fields: [
                  {
                    name: '👥 General Commands',
                    value:
                      '`/today` — View contests happening today\n`/upcoming [platform]` — View upcoming contests for the next 7 days\n`/help` — View this message',
                  },
                  {
                    name: '🛡️ Admin Commands',
                    value:
                      '`/sync` — Force an immediate contest synchronization from CLIST\n`/config view` — View current server configuration\n`/config timezone` — Set server timezone (e.g. `Asia/Kolkata`)\n`/config channels` — Configure notification channels\n`/config platform` — Enable or disable platform alerts',
                  },
                  {
                    name: '⚙️ Current Server Timezone',
                    value: `\`${timezone}\``,
                  },
                ],
              },
            ],
          },
        }),
      };
    }

    // Command: /sync (Admin)
    if (name === 'sync') {
      try {
        const service = new ContestService(undefined, repo);
        const summary = await service.syncContests();

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ **CLIST Sync Successful!**\n• Fetched: **${summary.fetched}** contests\n• New: **${summary.newContests}**\n• Rescheduled: **${summary.rescheduledContests}**\n• Cancelled: **${summary.cancelledContests}**`,
            },
          }),
        };
      } catch (err: any) {
        logger.error('Error during slash command /sync', err);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `❌ **Sync failed:** ${err.message || 'Unknown error'}`,
            },
          }),
        };
      }
    }

    // Command: /config (Admin)
    if (name === 'config') {
      const subCommand = options?.[0]?.name;
      const subOptions = options?.[0]?.options || [];

      let currentServer = await repo.getServer(guildId);
      if (!currentServer) {
        currentServer = {
          guildId,
          timezone: config.defaultTimezone,
          enabled: true,
        };
        await repo.upsertServer(currentServer);
      }

      if (subCommand === 'view') {
        const platforms = await repo.getServerEnabledPlatforms(guildId);
        const platformText =
          platforms.length > 0
            ? platforms.map((p) => `• ${p.toUpperCase()}`).join('\n')
            : '• All platforms enabled (default)';

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              embeds: [
                {
                  title: '⚙️ Server Configuration',
                  color: 0x5865f2,
                  fields: [
                    { name: 'Server ID', value: guildId, inline: true },
                    { name: 'Timezone', value: currentServer.timezone, inline: true },
                    {
                      name: 'Channels',
                      value: `Contest Start: ${
                        currentServer.startedChannelId ? `<#${currentServer.startedChannelId}>` : 'Not configured'
                      }\nDaily Digest: ${
                        currentServer.dailyChannelId ? `<#${currentServer.dailyChannelId}>` : 'Not configured'
                      }\nWeekly Digest: ${
                        currentServer.weeklyChannelId ? `<#${currentServer.weeklyChannelId}>` : 'Not configured'
                      }`,
                    },
                    { name: 'Subscribed Platforms', value: platformText },
                  ],
                },
              ],
            },
          }),
        };
      }

      if (subCommand === 'timezone') {
        const newTz = subOptions.find((o: any) => o.name === 'timezone')?.value;
        try {
          Intl.DateTimeFormat(undefined, { timeZone: newTz });
          await repo.upsertServer({ ...currentServer, timezone: newTz });

          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: { content: `✅ Server timezone updated to **${newTz}**!` },
            }),
          };
        } catch {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                content: `❌ Invalid timezone \`${newTz}\`. Please use an IANA timezone such as \`Asia/Kolkata\`, \`America/New_York\`, or \`UTC\`.`,
              },
            }),
          };
        }
      }

      if (subCommand === 'channels') {
        const startedId = subOptions.find((o: any) => o.name === 'started')?.value;
        const dailyId = subOptions.find((o: any) => o.name === 'daily')?.value;
        const weeklyId = subOptions.find((o: any) => o.name === 'weekly')?.value;

        const updated = {
          ...currentServer,
          startedChannelId: startedId !== undefined ? startedId : currentServer.startedChannelId,
          dailyChannelId: dailyId !== undefined ? dailyId : currentServer.dailyChannelId,
          weeklyChannelId: weeklyId !== undefined ? weeklyId : currentServer.weeklyChannelId,
        };
        await repo.upsertServer(updated);

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ Notification channels updated!\n• Contest Start: ${
                updated.startedChannelId ? `<#${updated.startedChannelId}>` : 'unchanged'
              }\n• Daily Digest: ${
                updated.dailyChannelId ? `<#${updated.dailyChannelId}>` : 'unchanged'
              }\n• Weekly Digest: ${
                updated.weeklyChannelId ? `<#${updated.weeklyChannelId}>` : 'unchanged'
              }`,
            },
          }),
        };
      }

      if (subCommand === 'platform') {
        const platformName = subOptions.find((o: any) => o.name === 'name')?.value;
        const enabled = subOptions.find((o: any) => o.name === 'enabled')?.value;

        await repo.setServerPlatform(guildId, platformName, enabled);

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ Platform **${platformName.toUpperCase()}** is now **${
                enabled ? 'ENABLED' : 'DISABLED'
              }** for this server.`,
            },
          }),
        };
      }
    }
  }

  return {
    statusCode: 400,
    body: 'Unknown interaction',
  };
};

import { Handler } from '@netlify/functions';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { config } from '../../src/config.js';
import { PlatformRecord } from '../../src/contests/types.js';
import { ContestRepository } from '../../src/contests/repository.js';
import { ContestService } from '../../src/contests/service.js';
import { DiscordClient } from '../../src/discord/client.js';
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

  // 1. Verify public key
  const publicKey = config.discord.publicKey;
  if (!publicKey) {
    logger.warn('DISCORD_PUBLIC_KEY is not set in environment variables');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error: DISCORD_PUBLIC_KEY missing' }),
    };
  }

  // 2. Cryptographically verify signature using ED25519
  const isValidRequest = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValidRequest) {
    logger.warn('Received invalid Discord interaction signature');
    return { statusCode: 401, body: 'Invalid request signature' };
  }

  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  // 3. Respond to Discord PING (required for Developer Portal verification)
  if (interaction.type === InteractionType.PING) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: InteractionResponseType.PONG }),
    };
  }

  const repo = new ContestRepository();
  const guildId = interaction.guild_id || 'default';
  const server = await repo.getServer(guildId);
  const timezone = server?.timezone || config.defaultTimezone;
  const now = new Date();

  // 4. Handle Interactive Message Components (e.g. Multi-Select Menu for platforms)
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = interaction.data?.custom_id;

    if (customId === 'select_platforms') {
      const selectedPlatforms: string[] = interaction.data?.values || [];
      await repo.setServerPlatforms(guildId, selectedPlatforms);

      const allPlatforms = await repo.getAllPlatforms();
      const displayNames = allPlatforms
        .filter((p) => selectedPlatforms.includes(p.id))
        .map((p) => `• **${p.name}**`);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: {
            content: `✅ **Successfully updated platform subscriptions!**\n\nThis server will now receive notifications and digests for:\n${
              displayNames.length > 0 ? displayNames.join('\n') : '*(None selected)*'
            }\n\n*You can change this anytime using \`/config platforms\`.*`,
            embeds: [],
            components: [],
          },
        }),
      };
    }
  }

  // 5. Handle Application Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name, options } = interaction.data;
    logger.info(`Received slash command: /${name} from guild: ${guildId}`);

    // Command: /today
    if (name === 'today') {
      const { startUtc, endUtc } = getServerDayBounds(now, timezone);
      const enabledPlatforms = await repo.getServerEnabledPlatforms(guildId);

      const contests = await repo.findContestsInWindow(startUtc, endUtc, enabledPlatforms);
      const payload = formatDailyDigestMessage(contests, timezone);

      if (!server?.startedChannelId && !server?.dailyChannelId && payload.embeds && payload.embeds[0]) {
        payload.embeds[0].footer = {
          text: '💡 Tip: Automated alerts are paused until an admin runs /config channels',
        };
      }

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
        platformsFilter = await repo.getServerEnabledPlatforms(guildId);
      }

      const contests = await repo.findContestsInWindow(startUtc, endUtc, platformsFilter);
      const payload = formatWeeklyDigestMessage(contests, timezone);

      if (!server?.startedChannelId && !server?.dailyChannelId && payload.embeds && payload.embeds[0]) {
        payload.embeds[0].footer = {
          text: '💡 Tip: Automated alerts are paused until an admin runs /config channels',
        };
      }

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
                  'A serverless bot that automatically notifies your server about competitive programming contests from Codeforces, LeetCode, CodeChef, and more.',
                color: 0x5865f2,
                fields: [
                  {
                    name: '👥 General Commands',
                    value:
                      '`/today` — View contests happening today\n`/upcoming [platform]` — View upcoming contests for the next 7 days\n`/help` — View commands and setup guide',
                  },
                  {
                    name: '🛡️ Admin Commands',
                    value:
                      '`/config view` — View current server setup and active platforms\n`/config channels` — Configure channels for live alerts and digests\n`/config timezone` — Set server timezone (e.g. `Asia/Kolkata`)\n`/config role` — Set or clear the role to ping for alerts (`@Contestants`)\n`/config platforms` — Multi-select contest platforms to track\n`/config platform` — Toggle a specific platform on/off\n`/config test` — Test alert delivery and bot permissions\n`/sync` — Trigger immediate contest sync from CLIST',
                  },
                  {
                    name: '🚀 3-Step Server Quickstart Guide',
                    value:
                      '1️⃣ Run `/config channels started:#alerts daily:#digest`\n2️⃣ Run `/config timezone timezone:Asia/Kolkata`\n3️⃣ Run `/config test` to verify your channels!',
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
        const allPlatforms = await repo.getAllPlatforms();
        const platforms = await repo.getServerEnabledPlatforms(guildId);
        const platformText = platforms
          .map((p) => {
            const info = allPlatforms.find((item) => item.id === p);
            return `• **${info ? info.name : p.toUpperCase()}**`;
          })
          .join('\n');

        const hasChannels = currentServer.startedChannelId || currentServer.dailyChannelId || currentServer.weeklyChannelId;
        const fields: any[] = [
          { name: 'Server ID', value: guildId, inline: true },
          { name: 'Timezone', value: currentServer.timezone, inline: true },
          {
            name: 'Alert Role',
            value: currentServer.alertRoleId ? `<@&${currentServer.alertRoleId}>` : 'None *(silent alerts)*',
            inline: true,
          },
          {
            name: 'Morning Digest Time',
            value: `${currentServer.digestHour ?? 8}:00 AM local time`,
            inline: true,
          },
          {
            name: 'Channels',
            value: `Contest Start: ${
              currentServer.startedChannelId ? `<#${currentServer.startedChannelId}>` : '⚠️ *Not configured*'
            }\nDaily Digest: ${
              currentServer.dailyChannelId ? `<#${currentServer.dailyChannelId}>` : '⚠️ *Not configured*'
            }\nWeekly Digest: ${
              currentServer.weeklyChannelId ? `<#${currentServer.weeklyChannelId}>` : '⚠️ *Not configured*'
            }`,
          },
          {
            name: 'Subscribed Platforms (Default: Codeforces, CodeChef, LeetCode)',
            value: platformText || '*(None)*',
          },
        ];

        if (!hasChannels) {
          fields.unshift({
            name: '🚨 Action Required: Setup Your Channels',
            value:
              'Contest notifications are currently paused because no channel is set! Run:\n👉 `/config channels started:#your-channel daily:#your-channel`\nThen run `/config test` to verify delivery.',
          });
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              embeds: [
                {
                  title: '⚙️ Server Configuration',
                  color: hasChannels ? 0x5865f2 : 0xfee75c,
                  fields,
                },
              ],
            },
          }),
        };
      }

      // Subcommand: /config platforms (Interactive Dropdown Menu)
      if (subCommand === 'platforms') {
        const allPlatforms = await repo.getAllPlatforms();
        const currentlyEnabled = await repo.getServerEnabledPlatforms(guildId);

        const selectOptions = allPlatforms.map((p) => ({
          label: p.name,
          value: p.id,
          description: (p.description || '').slice(0, 50),
          default: currentlyEnabled.includes(p.id),
        }));

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '🎯 **Select Contest Platforms to Track**\nChoose all the platforms you want to receive alerts and digests for on this server:',
              components: [
                {
                  type: 1, // Action Row
                  components: [
                    {
                      type: 3, // String Select Menu
                      custom_id: 'select_platforms',
                      placeholder: 'Select platforms...',
                      min_values: 1,
                      max_values: allPlatforms.length,
                      options: selectOptions,
                    },
                  ],
                },
              ],
            },
          }),
        };
      }

      // Subcommand: /config platform name:<choice> enabled:<boolean>
      if (subCommand === 'platform') {
        const platformName = subOptions.find((o: any) => o.name === 'name')?.value;
        const enabled = subOptions.find((o: any) => o.name === 'enabled')?.value;

        await repo.setServerPlatform(guildId, platformName, enabled);

        const allPlatforms = await repo.getAllPlatforms();
        const info = allPlatforms.find((p) => p.id === platformName.toLowerCase());
        const prettyName = info ? info.name : platformName.toUpperCase();

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `✅ Platform **${prettyName}** is now **${
                enabled ? 'ENABLED' : 'DISABLED'
              }** for this server.`,
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

      // Subcommand: /config role role:<@role>
      if (subCommand === 'role') {
        const roleId = subOptions.find((o: any) => o.name === 'role')?.value;
        const updated = {
          ...currentServer,
          alertRoleId: roleId || null,
        };
        await repo.upsertServer(updated);

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: roleId
                ? `✅ **Alert Role Configured!**\nThe bot will now ping <@&${roleId}> when live contest alerts and digests drop.`
                : `✅ **Alert Role Cleared.**\nNotifications will now be posted silently without role pings.`,
            },
          }),
        };
      }

      // Subcommand: /config test
      if (subCommand === 'test') {
        const results: string[] = [];
        const discordClient = new DiscordClient();
        const sampleContest: any = {
          id: 'test-sample',
          externalId: 'test-001',
          platform: 'leetcode',
          name: 'Weekly Contest (Sample Test Alert)',
          url: 'https://leetcode.com',
          startTime: new Date(Date.now() + 1800 * 1000),
          endTime: new Date(Date.now() + 5400 * 1000),
          duration: 5400,
          status: 'SCHEDULED',
          lastSyncedAt: new Date(),
        };

        // 1. Test live contest start channel
        if (currentServer.startedChannelId) {
          try {
            await discordClient.sendContestStarted(sampleContest, {
              channelId: currentServer.startedChannelId,
              timezone: currentServer.timezone,
              alertRoleId: currentServer.alertRoleId,
            });
            results.push(`• **Live Alerts Channel:** ✅ Sent test alert to <#${currentServer.startedChannelId}>`);
          } catch (err: any) {
            results.push(`• **Live Alerts Channel:** ❌ Failed sending to <#${currentServer.startedChannelId}> (*${err.message || 'Missing permissions'}*)`);
          }
        } else {
          results.push(`• **Live Alerts Channel:** ⚠️ Not configured (run \`/config channels started:#channel\`)`);
        }

        // 2. Test daily digest channel
        if (currentServer.dailyChannelId) {
          try {
            await discordClient.sendDailyDigest([sampleContest], {
              channelId: currentServer.dailyChannelId,
              timezone: currentServer.timezone,
              alertRoleId: currentServer.alertRoleId,
            });
            results.push(`• **Daily Digest Channel:** ✅ Sent test digest to <#${currentServer.dailyChannelId}>`);
          } catch (err: any) {
            results.push(`• **Daily Digest Channel:** ❌ Failed sending to <#${currentServer.dailyChannelId}> (*${err.message || 'Missing permissions'}*)`);
          }
        } else {
          results.push(`• **Daily Digest Channel:** ⚠️ Not configured (run \`/config channels daily:#channel\`)`);
        }

        // 3. Test weekly digest channel
        if (currentServer.weeklyChannelId) {
          try {
            await discordClient.sendWeeklyDigest([sampleContest], {
              channelId: currentServer.weeklyChannelId,
              timezone: currentServer.timezone,
              alertRoleId: currentServer.alertRoleId,
            });
            results.push(`• **Weekly Digest Channel:** ✅ Sent test weekly digest to <#${currentServer.weeklyChannelId}>`);
          } catch (err: any) {
            results.push(`• **Weekly Digest Channel:** ❌ Failed sending to <#${currentServer.weeklyChannelId}> (*${err.message || 'Missing permissions'}*)`);
          }
        } else {
          results.push(`• **Weekly Digest Channel:** ⚠️ Not configured (run \`/config channels weekly:#channel\`)`);
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              embeds: [
                {
                  title: '🧪 Channel Configuration Test Results',
                  color: 0x57f287,
                  description: results.join('\n\n'),
                  footer: {
                    text: 'If any channel failed, verify that the bot has "View Channel", "Send Messages", and "Embed Links" permissions in that channel.',
                  },
                },
              ],
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

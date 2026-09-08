import { Contest } from '../contests/types.js';
import { formatDuration, formatInServerTimezone, getDiscordTimestamp } from '../utils/timezone.js';
import { DiscordEmbed, DiscordMessagePayload } from './types.js';

export const PLATFORM_COLORS: Record<string, number> = {
  codeforces: 0x1f8acb,
  leetcode: 0xffa116,
  atcoder: 0x333333,
  codechef: 0x5b4638,
  hackerrank: 0x00ea64,
  topcoder: 0x0096d6,
  kaggle: 0x20beff,
  default: 0x5865f2,
};

export function getPlatformColor(platform: string): number {
  return PLATFORM_COLORS[platform.toLowerCase()] ?? PLATFORM_COLORS.default;
}

export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Builds the Contest Started Discord embed according to spec.
 */
export function formatContestStartedMessage(contest: Contest, timezone: string = 'UTC'): DiscordMessagePayload {
  const platformName = capitalize(contest.platform);
  const durationText = formatDuration(contest.duration);
  const localTimeText = formatInServerTimezone(contest.startTime, timezone, 'HH:mm (zzz)');
  const relativeTime = getDiscordTimestamp(contest.startTime, 'R');

  const embed: DiscordEmbed = {
    title: '🚨 CONTEST STARTED',
    description: `**[${contest.name}](${contest.url})**\n\n[Join Contest](${contest.url})`,
    url: contest.url,
    color: getPlatformColor(contest.platform),
    fields: [
      {
        name: 'Platform',
        value: platformName,
        inline: true,
      },
      {
        name: 'Duration',
        value: durationText,
        inline: true,
      },
      {
        name: 'Started At',
        value: `${localTimeText} (${relativeTime})`,
        inline: false,
      },
    ],
    footer: {
      text: `Contest Notifier • ${timezone}`,
    },
    timestamp: contest.startTime.toISOString(),
  };

  return {
    embeds: [embed],
  };
}

/**
 * Builds the Daily Digest Discord embed.
 */
export function formatDailyDigestMessage(contests: Contest[], timezone: string = 'UTC'): DiscordMessagePayload {
  if (contests.length === 0) {
    return {
      embeds: [
        {
          title: "📅 TODAY'S CONTESTS",
          description: 'No contests scheduled for today. Have a great day!',
          color: PLATFORM_COLORS.default,
          footer: {
            text: `0 contests today • Timezone: ${timezone}`,
          },
        },
      ],
    };
  }

  // Sort chronologically
  const sorted = [...contests].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const lines = sorted.map((c) => {
    const time = formatInServerTimezone(c.startTime, timezone, 'HH:mm');
    const dur = formatDuration(c.duration);
    return `• **${time}** — [${c.name}](${c.url}) (${capitalize(c.platform)}, ${dur})`;
  });

  const countText = `${sorted.length} contest${sorted.length === 1 ? '' : 's'} today.`;

  const embed: DiscordEmbed = {
    title: "📅 TODAY'S CONTESTS",
    description: `${lines.join('\n')}\n\n*${countText}*`,
    color: 0x57f287, // Green
    footer: {
      text: `${countText} • Timezone: ${timezone}`,
    },
    timestamp: new Date().toISOString(),
  };

  return {
    embeds: [embed],
  };
}

/**
 * Builds the Weekly Digest Discord embed grouped by day of the week.
 */
export function formatWeeklyDigestMessage(contests: Contest[], timezone: string = 'UTC'): DiscordMessagePayload {
  if (contests.length === 0) {
    return {
      embeds: [
        {
          title: "📅 THIS WEEK'S CONTESTS",
          description: 'No contests scheduled for the upcoming week.',
          color: PLATFORM_COLORS.default,
          footer: {
            text: `0 contests this week • Timezone: ${timezone}`,
          },
        },
      ],
    };
  }

  // Sort chronologically
  const sorted = [...contests].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Group by day name in server timezone (e.g. "MONDAY", "TUESDAY", etc.)
  const dayGroups = new Map<string, Contest[]>();

  for (const c of sorted) {
    const dayName = formatInServerTimezone(c.startTime, timezone, 'EEEE').toUpperCase();
    const dateFormatted = formatInServerTimezone(c.startTime, timezone, 'MMM d');
    const groupKey = `${dayName} (${dateFormatted})`;
    if (!dayGroups.has(groupKey)) {
      dayGroups.set(groupKey, []);
    }
    dayGroups.get(groupKey)!.push(c);
  }

  const sections: string[] = [];

  for (const [dayHeader, dayContests] of dayGroups.entries()) {
    const items = dayContests.map((c) => {
      const time = formatInServerTimezone(c.startTime, timezone, 'HH:mm');
      const dur = formatDuration(c.duration);
      return `• **${time}** — [${c.name}](${c.url}) (${capitalize(c.platform)}, ${dur})`;
    });
    sections.push(`**${dayHeader}**\n${items.join('\n')}`);
  }

  const countText = `${sorted.length} contest${sorted.length === 1 ? '' : 's'} this week.`;

  const embed: DiscordEmbed = {
    title: "📅 THIS WEEK'S CONTESTS",
    description: sections.join('\n\n'),
    color: 0x5865f2,
    footer: {
      text: `${countText} • Timezone: ${timezone}`,
    },
    timestamp: new Date().toISOString(),
  };

  return {
    embeds: [embed],
  };
}

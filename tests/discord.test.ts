import { describe, it, expect, vi } from 'vitest';
import { DiscordClient, DiscordApiError } from '../src/discord/client.js';
import {
  formatContestStartedMessage,
  formatDailyDigestMessage,
  formatWeeklyDigestMessage,
} from '../src/discord/formatter.js';
import { Contest } from '../src/contests/types.js';

describe('Discord Formatting & HTTP Client', () => {
  const sampleContest: Contest = {
    id: 'cf-test-1',
    externalId: '1001',
    platform: 'codeforces',
    name: 'Codeforces Round #999',
    url: 'https://codeforces.com/contest/999',
    startTime: new Date('2026-09-10T14:35:00.000Z'),
    endTime: new Date('2026-09-10T16:50:00.000Z'),
    duration: 8100, // 2h 15m
    status: 'RUNNING',
    lastSyncedAt: new Date(),
  };

  it('should format contest started message with required fields and duration', () => {
    const payload = formatContestStartedMessage(sampleContest, 'UTC');
    expect(payload.embeds).toBeDefined();
    expect(payload.embeds?.length).toBe(1);

    const embed = payload.embeds![0];
    expect(embed.title).toBe('🚨 CONTEST STARTED');
    expect(embed.description).toContain('Codeforces Round #999');
    expect(embed.description).toContain('[Join Contest](https://codeforces.com/contest/999)');

    const platformField = embed.fields?.find((f) => f.name === 'Platform');
    expect(platformField?.value).toBe('Codeforces');

    const durationField = embed.fields?.find((f) => f.name === 'Duration');
    expect(durationField?.value).toBe('2h 15m');
  });

  it('should format daily digest with chronological sorting', () => {
    const contest1: Contest = {
      ...sampleContest,
      id: 'c1',
      startTime: new Date('2026-09-10T20:00:00.000Z'),
      name: 'CodeChef Starters',
      platform: 'codechef',
    };
    const contest2: Contest = {
      ...sampleContest,
      id: 'c2',
      startTime: new Date('2026-09-10T17:30:00.000Z'),
      name: 'AtCoder Beginner Contest',
      platform: 'atcoder',
    };

    const payload = formatDailyDigestMessage([contest1, contest2], 'UTC');
    const embed = payload.embeds![0];
    expect(embed.title).toBe("📅 TODAY'S CONTESTS");
    expect(embed.description).toContain('2 contests today');

    // Chronological order: 17:30 should appear before 20:00
    const posAtCoder = embed.description!.indexOf('AtCoder');
    const posCodeChef = embed.description!.indexOf('CodeChef');
    expect(posAtCoder).toBeLessThan(posCodeChef);
  });

  it('should format weekly digest grouped by day of the week', () => {
    // Monday
    const contestMon: Contest = {
      ...sampleContest,
      id: 'c-mon',
      startTime: new Date('2026-09-14T20:00:00.000Z'),
      name: 'CodeChef Starters',
      platform: 'codechef',
    };
    // Tuesday
    const contestTue: Contest = {
      ...sampleContest,
      id: 'c-tue',
      startTime: new Date('2026-09-15T18:35:00.000Z'),
      name: 'Codeforces Round',
      platform: 'codeforces',
    };

    const payload = formatWeeklyDigestMessage([contestMon, contestTue], 'UTC');
    const embed = payload.embeds![0];
    expect(embed.title).toBe("📅 THIS WEEK'S CONTESTS");
    expect(embed.description).toContain('MONDAY');
    expect(embed.description).toContain('TUESDAY');
    expect(embed.description).toContain('CodeChef Starters');
    expect(embed.description).toContain('Codeforces Round');
  });

  it('should send payload via webhook URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const client = new DiscordClient({ fetchFn: mockFetch as unknown as typeof fetch });
    const success = await client.sendContestStarted(sampleContest, {
      webhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should send payload via channel ID with bot token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const client = new DiscordClient({
      botToken: 'bot-secret-token',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const success = await client.sendDailyDigest([sampleContest], {
      channelId: 'channel-999',
    });

    expect(success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/channel-999/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bot bot-secret-token',
        },
      })
    );
  });

  it('should handle rate limiting 429 and retry', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
          json: async () => ({ retry_after: 0 }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    });

    const client = new DiscordClient({
      botToken: 'token',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const success = await client.sendContestStarted(sampleContest, {
      channelId: 'chan-1',
    });

    expect(success).toBe(true);
    expect(callCount).toBe(2);
  });
});

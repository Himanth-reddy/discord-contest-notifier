import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '../src/database/adapter.js';
import { runMigrations } from '../src/database/migrate.js';
import { ContestRepository } from '../src/contests/repository.js';
import { setDatabaseAdapter } from '../src/database/connection.js';
import { executeDailyDigest } from '../src/digests/daily.js';
import { executeWeeklyDigest } from '../src/digests/weekly.js';
import { DiscordClient } from '../src/discord/client.js';
import { NotificationScheduler } from '../src/notifications/scheduler.js';
import { WorkloadDispatcher } from '../src/notifications/types.js';

describe('Daily & Weekly Digests', () => {
  let adapter: SqliteAdapter;
  let repo: ContestRepository;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    setDatabaseAdapter(adapter);
    await runMigrations(adapter);
    repo = new ContestRepository(adapter);
  });

  afterEach(async () => {
    await adapter.close();
    setDatabaseAdapter(null);
  });

  it('should send daily digest for contests occurring today and schedule notifications', async () => {
    const today = new Date('2026-09-10T10:00:00.000Z');

    // Contest today at 14:00 UTC
    const c1 = (
      await repo.upsertContest({
        externalId: 'today-1',
        platform: 'codeforces',
        name: 'CF Round Today',
        url: 'https://codeforces.com/today-1',
        startTime: new Date('2026-09-10T14:00:00.000Z'),
        endTime: new Date('2026-09-10T16:00:00.000Z'),
        duration: 7200,
        status: 'SCHEDULED',
      })
    ).contest;

    // Contest tomorrow
    await repo.upsertContest({
      externalId: 'tomorrow-1',
      platform: 'atcoder',
      name: 'ABC Tomorrow',
      url: 'https://atcoder.jp/tomorrow-1',
      startTime: new Date('2026-09-11T12:00:00.000Z'),
      endTime: new Date('2026-09-11T14:00:00.000Z'),
      duration: 7200,
      status: 'SCHEDULED',
    });

    await repo.upsertServer({
      guildId: 'server-daily',
      timezone: 'UTC',
      dailyChannelId: 'chan-daily-1',
      enabled: true,
    });

    const mockSendDaily = vi.fn().mockResolvedValue(true);
    const mockDiscord = { sendDailyDigest: mockSendDaily } as unknown as DiscordClient;

    const mockDispatcher: WorkloadDispatcher = { send: vi.fn().mockResolvedValue({ sendStatus: 'succeeded' }) };
    const scheduler = new NotificationScheduler(repo, mockDispatcher);

    const result = await executeDailyDigest({
      repo,
      discord: mockDiscord,
      scheduler,
      now: today,
      force: true,
    });

    expect(result.digestsSent).toBe(1);
    expect(mockSendDaily).toHaveBeenCalledTimes(1);

    const callArgs = mockSendDaily.mock.calls[0];
    const contestsPassed = callArgs[0];
    expect(contestsPassed.length).toBe(1);
    expect(contestsPassed[0].id).toBe(c1.id);

    // Verify contest start notification was scheduled
    const notif = await repo.getNotification(c1.id, 'CONTEST_STARTED');
    expect(notif).not.toBeNull();
  });

  it('should send weekly digest for contests occurring in next 7 days', async () => {
    const refDate = new Date('2026-09-08T08:00:00.000Z');

    // In 2 days
    await repo.upsertContest({
      externalId: 'in-2-days',
      platform: 'codeforces',
      name: 'CF In 2 Days',
      url: 'https://codeforces.com/2days',
      startTime: new Date('2026-09-10T14:00:00.000Z'),
      endTime: new Date('2026-09-10T16:00:00.000Z'),
      duration: 7200,
      status: 'SCHEDULED',
    });

    // In 5 days
    await repo.upsertContest({
      externalId: 'in-5-days',
      platform: 'leetcode',
      name: 'LC In 5 Days',
      url: 'https://leetcode.com/5days',
      startTime: new Date('2026-09-13T02:30:00.000Z'),
      endTime: new Date('2026-09-13T04:00:00.000Z'),
      duration: 5400,
      status: 'SCHEDULED',
    });

    // In 10 days (outside weekly window)
    await repo.upsertContest({
      externalId: 'in-10-days',
      platform: 'codechef',
      name: 'CodeChef In 10 Days',
      url: 'https://codechef.com/10days',
      startTime: new Date('2026-09-20T14:00:00.000Z'),
      endTime: new Date('2026-09-20T16:00:00.000Z'),
      duration: 7200,
      status: 'SCHEDULED',
    });

    await repo.upsertServer({
      guildId: 'server-weekly',
      timezone: 'UTC',
      weeklyChannelId: 'chan-weekly-1',
      enabled: true,
    });

    const mockSendWeekly = vi.fn().mockResolvedValue(true);
    const mockDiscord = { sendWeeklyDigest: mockSendWeekly } as unknown as DiscordClient;

    const result = await executeWeeklyDigest({
      repo,
      discord: mockDiscord,
      now: refDate,
      force: true,
    });

    expect(result.digestsSent).toBe(1);
    expect(mockSendWeekly).toHaveBeenCalledTimes(1);

    const contestsPassed = mockSendWeekly.mock.calls[0][0];
    expect(contestsPassed.length).toBe(2);
    const names = contestsPassed.map((c: any) => c.name);
    expect(names).toContain('CF In 2 Days');
    expect(names).toContain('LC In 5 Days');
    expect(names).not.toContain('CodeChef In 10 Days');
  });

  it('should deliver daily digest at local morning hour and include alertRoleId', async () => {
    await repo.upsertServer({
      guildId: 'server-india',
      timezone: 'Asia/Kolkata',
      dailyChannelId: 'chan-india-daily',
      alertRoleId: 'role-contestants',
      digestHour: 8,
      enabled: true,
    });

    const mockSendDaily = vi.fn().mockResolvedValue(true);
    const mockDiscord = { sendDailyDigest: mockSendDaily } as unknown as DiscordClient;
    const mockDispatcher: WorkloadDispatcher = { send: vi.fn().mockResolvedValue({ sendStatus: 'succeeded' }) };
    const scheduler = new NotificationScheduler(repo, mockDispatcher);

    // 08:00 AM IST is 02:30 AM UTC
    const morningInIndia = new Date('2026-09-10T02:30:00.000Z');

    // 1. Should send when it is 8:00 AM in India
    const result1 = await executeDailyDigest({
      repo,
      discord: mockDiscord,
      scheduler,
      now: morningInIndia,
      force: false,
    });
    expect(result1.digestsSent).toBe(1);
    expect(mockSendDaily).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        channelId: 'chan-india-daily',
        alertRoleId: 'role-contestants',
        timezone: 'Asia/Kolkata',
      })
    );

    // 2. Immediate second call on same day should be skipped (deduplicated)
    const resultDuplicate = await executeDailyDigest({
      repo,
      discord: mockDiscord,
      scheduler,
      now: morningInIndia,
      force: false,
    });
    expect(resultDuplicate.digestsSent).toBe(0);

    // 3. At 2:00 PM IST (08:30 UTC), should not send
    const afternoonInIndia = new Date('2026-09-11T08:30:00.000Z');
    const resultAfternoon = await executeDailyDigest({
      repo,
      discord: mockDiscord,
      scheduler,
      now: afternoonInIndia,
      force: false,
    });
    expect(resultAfternoon.digestsSent).toBe(0);
  });
});

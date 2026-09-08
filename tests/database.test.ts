import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../src/database/adapter.js';
import { runMigrations } from '../src/database/migrate.js';
import { ContestRepository } from '../src/contests/repository.js';
import { setDatabaseAdapter } from '../src/database/connection.js';

describe('Database & Repository Integration', () => {
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

  it('should insert a new contest and detect NEW changeType', async () => {
    const startTime = new Date(Date.now() + 3600 * 1000);
    const endTime = new Date(Date.now() + 7200 * 1000);

    const result = await repo.upsertContest({
      externalId: 'cf-1001',
      platform: 'codeforces',
      name: 'Codeforces Round 1001',
      url: 'https://codeforces.com/contest/1001',
      startTime,
      endTime,
      duration: 3600,
      status: 'SCHEDULED',
    });

    expect(result.changeType).toBe('NEW');
    expect(result.contest.id).toBeDefined();
    expect(result.contest.externalId).toBe('cf-1001');
    expect(result.contest.platform).toBe('codeforces');
    expect(result.contest.startTime.toISOString()).toBe(startTime.toISOString());
  });

  it('should detect UNCHANGED when updating identical contest details', async () => {
    const startTime = new Date('2026-09-10T14:00:00.000Z');
    const endTime = new Date('2026-09-10T16:00:00.000Z');

    const first = await repo.upsertContest({
      externalId: 'cf-1002',
      platform: 'codeforces',
      name: 'Codeforces Round 1002',
      url: 'https://codeforces.com/contest/1002',
      startTime,
      endTime,
      duration: 7200,
      status: 'SCHEDULED',
    });
    expect(first.changeType).toBe('NEW');

    const second = await repo.upsertContest({
      externalId: 'cf-1002',
      platform: 'codeforces',
      name: 'Codeforces Round 1002',
      url: 'https://codeforces.com/contest/1002',
      startTime,
      endTime,
      duration: 7200,
      status: 'SCHEDULED',
    });
    expect(second.changeType).toBe('UNCHANGED');
    expect(second.contest.id).toBe(first.contest.id);
  });

  it('should detect RESCHEDULED when startTime changes', async () => {
    const originalStart = new Date('2026-09-10T14:00:00.000Z');
    const newStart = new Date('2026-09-10T15:30:00.000Z');

    const res1 = await repo.upsertContest({
      externalId: 'cf-1003',
      platform: 'codeforces',
      name: 'Codeforces Round 1003',
      url: 'https://codeforces.com/contest/1003',
      startTime: originalStart,
      endTime: new Date('2026-09-10T16:00:00.000Z'),
      duration: 7200,
      status: 'SCHEDULED',
    });
    expect(res1.changeType).toBe('NEW');

    const res2 = await repo.upsertContest({
      externalId: 'cf-1003',
      platform: 'codeforces',
      name: 'Codeforces Round 1003 (Rescheduled)',
      url: 'https://codeforces.com/contest/1003',
      startTime: newStart,
      endTime: new Date('2026-09-10T17:30:00.000Z'),
      duration: 7200,
      status: 'SCHEDULED',
    });

    expect(res2.changeType).toBe('RESCHEDULED');
    expect(res2.contest.id).toBe(res1.contest.id);
    expect(res2.oldStartTime?.toISOString()).toBe(originalStart.toISOString());
    expect(res2.contest.startTime.toISOString()).toBe(newStart.toISOString());
  });

  it('should handle notification scheduling and atomic idempotency claim', async () => {
    const contest = (
      await repo.upsertContest({
        externalId: 'lc-weekly-400',
        platform: 'leetcode',
        name: 'Weekly Contest 400',
        url: 'https://leetcode.com/contest/weekly-400',
        startTime: new Date('2026-09-11T02:30:00.000Z'),
        endTime: new Date('2026-09-11T04:00:00.000Z'),
        duration: 5400,
        status: 'SCHEDULED',
      })
    ).contest;

    // Schedule notification
    const notif = await repo.scheduleNotification(contest.id, contest.startTime);
    expect(notif.contestId).toBe(contest.id);
    expect(notif.sentAt).toBeNull();

    // Re-scheduling should not create duplicate
    const notif2 = await repo.scheduleNotification(contest.id, contest.startTime);
    expect(notif2.id).toBe(notif.id);

    // First atomic claim should succeed
    const claimed1 = await repo.claimAndMarkNotificationSent(contest.id, new Date());
    expect(claimed1).toBe(true);

    // Second atomic claim (e.g. Workload retry) MUST return false
    const claimed2 = await repo.claimAndMarkNotificationSent(contest.id, new Date());
    expect(claimed2).toBe(false);
  });

  it('should store and retrieve multi-server configurations and platforms', async () => {
    await repo.upsertServer({
      guildId: 'guild-12345',
      name: 'Competitive Coders Club',
      timezone: 'Asia/Kolkata',
      startedChannelId: 'chan-started',
      dailyChannelId: 'chan-daily',
      weeklyChannelId: 'chan-weekly',
      enabled: true,
    });

    await repo.setServerPlatform('guild-12345', 'codeforces', true);
    await repo.setServerPlatform('guild-12345', 'leetcode', true);
    await repo.setServerPlatform('guild-12345', 'codechef', false);

    const server = await repo.getServer('guild-12345');
    expect(server).not.toBeNull();
    expect(server?.timezone).toBe('Asia/Kolkata');

    const platforms = await repo.getServerEnabledPlatforms('guild-12345');
    expect(platforms).toContain('codeforces');
    expect(platforms).toContain('leetcode');
    expect(platforms).not.toContain('codechef');
  });
});

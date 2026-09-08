import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '../src/database/adapter.js';
import { runMigrations } from '../src/database/migrate.js';
import { ContestRepository } from '../src/contests/repository.js';
import { setDatabaseAdapter } from '../src/database/connection.js';
import { ContestService } from '../src/contests/service.js';
import { ClistClient } from '../src/clist/client.js';
import { NotificationScheduler } from '../src/notifications/scheduler.js';
import { WorkloadDispatcher } from '../src/notifications/types.js';

describe('Contest Synchronization Service', () => {
  let adapter: SqliteAdapter;
  let repo: ContestRepository;
  let mockDispatcher: WorkloadDispatcher;
  let scheduler: NotificationScheduler;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    setDatabaseAdapter(adapter);
    await runMigrations(adapter);
    repo = new ContestRepository(adapter);
    mockDispatcher = { send: vi.fn().mockResolvedValue({ sendStatus: 'succeeded' }) };
    scheduler = new NotificationScheduler(repo, mockDispatcher);
  });

  afterEach(async () => {
    await adapter.close();
    setDatabaseAdapter(null);
  });

  it('should sync contests from CLIST, insert them into DB, and schedule notifications', async () => {
    const mockClist = {
      fetchContests: vi.fn().mockResolvedValue([
        {
          externalId: 'cf-2001',
          platform: 'codeforces',
          name: 'Codeforces Round 2001',
          url: 'https://codeforces.com/2001',
          startTime: new Date(Date.now() + 3600 * 1000),
          endTime: new Date(Date.now() + 7200 * 1000),
          duration: 3600,
        },
        {
          externalId: 'lc-401',
          platform: 'leetcode',
          name: 'Weekly Contest 401',
          url: 'https://leetcode.com/401',
          startTime: new Date(Date.now() + 86400 * 1000),
          endTime: new Date(Date.now() + 86400 * 1000 + 5400 * 1000),
          duration: 5400,
        },
      ]),
    } as unknown as ClistClient;

    const service = new ContestService(mockClist, repo, scheduler);
    const summary = await service.syncContests();

    expect(summary.fetched).toBe(2);
    expect(summary.newContests).toBe(2);
    expect(summary.unchangedContests).toBe(0);
    expect(summary.rescheduledContests).toBe(0);

    // Verify persisted in DB
    const c1 = await repo.findByExternalId('codeforces', 'cf-2001');
    expect(c1).not.toBeNull();
    expect(c1?.name).toBe('Codeforces Round 2001');

    const notif1 = await repo.getNotification(c1!.id, 'CONTEST_STARTED');
    expect(notif1).not.toBeNull();

    // Verify workload dispatch was called twice
    expect(mockDispatcher.send).toHaveBeenCalledTimes(2);
  });

  it('should be safe to run sync multiple times without duplicates', async () => {
    const contests = [
      {
        externalId: 'atc-300',
        platform: 'atcoder',
        name: 'AtCoder Beginner 300',
        url: 'https://atcoder.jp/abc300',
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        duration: 3600,
      },
    ];

    const mockClist = {
      fetchContests: vi.fn().mockResolvedValue(contests),
    } as unknown as ClistClient;

    const service = new ContestService(mockClist, repo, scheduler);

    // First sync
    const sum1 = await service.syncContests();
    expect(sum1.newContests).toBe(1);

    // Second sync immediately after
    const sum2 = await service.syncContests();
    expect(sum2.newContests).toBe(0);
    expect(sum2.unchangedContests).toBe(1);

    // Database should still contain exactly 1 contest
    const all = await repo.findContestsInWindow(
      new Date(Date.now() - 1000),
      new Date(Date.now() + 10000 * 1000)
    );
    expect(all.length).toBe(1);
  });

  it('should detect when a contest start time is rescheduled during sync', async () => {
    const originalTime = new Date('2026-09-12T14:00:00.000Z');
    const rescheduledTime = new Date('2026-09-12T15:30:00.000Z');

    let currentContestTime = originalTime;

    const mockClist = {
      fetchContests: vi.fn().mockImplementation(async () => [
        {
          externalId: 'cf-resched-sync',
          platform: 'codeforces',
          name: 'CF Rescheduled Sync',
          url: 'https://codeforces.com/test',
          startTime: currentContestTime,
          endTime: new Date(currentContestTime.getTime() + 7200 * 1000),
          duration: 7200,
        },
      ]),
    } as unknown as ClistClient;

    const service = new ContestService(mockClist, repo, scheduler);

    // Initial sync
    const sum1 = await service.syncContests();
    expect(sum1.newContests).toBe(1);

    // Update CLIST time and re-sync
    currentContestTime = rescheduledTime;
    const sum2 = await service.syncContests();
    expect(sum2.rescheduledContests).toBe(1);
    expect(sum2.newContests).toBe(0);

    const c = await repo.findByExternalId('codeforces', 'cf-resched-sync');
    expect(c?.startTime.toISOString()).toBe(rescheduledTime.toISOString());

    const notif = await repo.getNotification(c!.id, 'CONTEST_STARTED');
    expect(notif?.scheduledFor.toISOString()).toBe(rescheduledTime.toISOString());
  });
});

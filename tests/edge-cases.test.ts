import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '../src/database/adapter.js';
import { runMigrations } from '../src/database/migrate.js';
import { ContestRepository } from '../src/contests/repository.js';
import { setDatabaseAdapter } from '../src/database/connection.js';
import { ContestService } from '../src/contests/service.js';
import { ClistClient } from '../src/clist/client.js';
import { NotificationScheduler } from '../src/notifications/scheduler.js';
import { WorkloadDispatcher } from '../src/notifications/types.js';
import { executeContestStartNotification } from '../src/notifications/contest-start.js';
import { DiscordClient } from '../src/discord/client.js';

describe('Edge Cases & Resiliency (Section 19)', () => {
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

  it('Contest already started when discovered (still active): schedules/sends immediately', async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() - 10 * 60 * 1000); // started 10m ago
    const endTime = new Date(now.getTime() + 50 * 60 * 1000); // ends in 50m

    const mockClist = {
      fetchContests: vi.fn().mockResolvedValue([
        {
          externalId: 'active-discovered-late',
          platform: 'codeforces',
          name: 'Active Round Discovered Late',
          url: 'https://codeforces.com/late',
          startTime,
          endTime,
          duration: 3600,
        },
      ]),
    } as unknown as ClistClient;

    const service = new ContestService(mockClist, repo, scheduler);
    const summary = await service.syncContests();

    expect(summary.newContests).toBe(1);
    const contest = summary.contests[0];
    expect(contest.status).toBe('RUNNING');

    // Should have scheduled notification immediately
    expect(mockDispatcher.send).toHaveBeenCalledTimes(1);

    // When executed, it sends since it is still active
    await repo.upsertServer({
      guildId: 'server-edge',
      startedChannelId: 'chan-edge',
      timezone: 'UTC',
      enabled: true,
    });

    const mockDiscord = { sendContestStarted: vi.fn().mockResolvedValue(true) } as unknown as DiscordClient;
    const notifResult = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
      now,
    });

    expect(notifResult.status).toBe('sent');
    expect(mockDiscord.sendContestStarted).toHaveBeenCalledTimes(1);
  });

  it('Contest already ended when discovered: does NOT schedule start notification', async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() - 120 * 60 * 1000); // started 2h ago
    const endTime = new Date(now.getTime() - 10 * 60 * 1000); // ended 10m ago

    const mockClist = {
      fetchContests: vi.fn().mockResolvedValue([
        {
          externalId: 'ended-contest',
          platform: 'atcoder',
          name: 'Already Finished Contest',
          url: 'https://atcoder.jp/finished',
          startTime,
          endTime,
          duration: 6600,
        },
      ]),
    } as unknown as ClistClient;

    const service = new ContestService(mockClist, repo, scheduler);
    const summary = await service.syncContests();

    expect(summary.newContests).toBe(1);
    const contest = summary.contests[0];
    expect(contest.status).toBe('FINISHED');

    // Must NOT schedule start notification
    expect(mockDispatcher.send).not.toHaveBeenCalled();

    const notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
    expect(notif).toBeNull();
  });

  it('Contest has no end time: handles correctly with null endTime', async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() + 1800 * 1000);

    const result = await repo.upsertContest({
      externalId: 'no-end-time',
      platform: 'codeforces',
      name: 'Indefinite Contest',
      url: 'https://codeforces.com/contest/indefinite',
      startTime,
      endTime: null,
      duration: null,
      status: 'SCHEDULED',
    });

    expect(result.contest.endTime).toBeNull();
    expect(result.contest.duration).toBeNull();

    await repo.upsertServer({
      guildId: 'server-no-end',
      startedChannelId: 'chan-cf',
      timezone: 'UTC',
      enabled: true,
    });

    const mockDiscord = { sendContestStarted: vi.fn().mockResolvedValue(true) } as unknown as DiscordClient;
    const notifResult = await executeContestStartNotification(result.contest.id, {
      repo,
      discordClient: mockDiscord,
      now: startTime,
    });

    expect(notifResult.status).toBe('sent');
    expect(mockDiscord.sendContestStarted).toHaveBeenCalledTimes(1);
  });

  it('Concurrent duplicate workload executions produce only ONE Discord message', async () => {
    const startTime = new Date(Date.now() - 5000);

    const contest = (
      await repo.upsertContest({
        externalId: 'concurrent-race',
        platform: 'codeforces',
        name: 'Concurrent Race Contest',
        url: 'https://codeforces.com/race',
        startTime,
        endTime: new Date(Date.now() + 3600 * 1000),
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await repo.scheduleNotification(contest.id, contest.startTime);

    await repo.upsertServer({
      guildId: 'server-race',
      startedChannelId: 'chan-race',
      timezone: 'UTC',
      enabled: true,
    });

    const mockDiscord = { sendContestStarted: vi.fn().mockResolvedValue(true) } as unknown as DiscordClient;

    const results = await Promise.all([
      executeContestStartNotification(contest.id, { repo, discordClient: mockDiscord }),
      executeContestStartNotification(contest.id, { repo, discordClient: mockDiscord }),
      executeContestStartNotification(contest.id, { repo, discordClient: mockDiscord }),
    ]);

    const sentResults = results.filter((r) => r.status === 'sent');
    const alreadySentResults = results.filter((r) => r.status === 'already_sent');

    expect(sentResults.length).toBe(1);
    expect(alreadySentResults.length).toBe(2);
    expect(mockDiscord.sendContestStarted).toHaveBeenCalledTimes(1);
  });
});

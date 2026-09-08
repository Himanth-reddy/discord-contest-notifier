import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '../src/database/adapter.js';
import { runMigrations } from '../src/database/migrate.js';
import { ContestRepository } from '../src/contests/repository.js';
import { setDatabaseAdapter } from '../src/database/connection.js';
import { executeContestStartNotification } from '../src/notifications/contest-start.js';
import { DiscordClient } from '../src/discord/client.js';
import { NotificationScheduler } from '../src/notifications/scheduler.js';
import { CONTEST_START_EVENT, WorkloadDispatcher } from '../src/notifications/types.js';

describe('Notification Scheduler & Execution Logic', () => {
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

  it('should dispatch workload event when scheduling contest start', async () => {
    const mockSend = vi.fn().mockResolvedValue({ sendStatus: 'succeeded' });
    const dispatcher: WorkloadDispatcher = { send: mockSend };
    const scheduler = new NotificationScheduler(repo, dispatcher);

    const contest = (
      await repo.upsertContest({
        externalId: 'cf-sched-1',
        platform: 'codeforces',
        name: 'Codeforces Round 1234',
        url: 'https://codeforces.com/contest/1234',
        startTime: new Date(Date.now() + 3600 * 1000),
        endTime: new Date(Date.now() + 7200 * 1000),
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await scheduler.scheduleContestStart(contest);

    expect(mockSend).toHaveBeenCalledWith(
      CONTEST_START_EVENT,
      expect.objectContaining({
        data: {
          contestId: contest.id,
          scheduledStartTime: contest.startTime.toISOString(),
        },
      })
    );

    const notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
    expect(notif).not.toBeNull();
    expect(notif?.scheduledFor.toISOString()).toBe(contest.startTime.toISOString());
  });

  it('should send Discord notification and mark sent when contest starts', async () => {
    const startTime = new Date(Date.now() - 1000); // 1 sec ago
    const endTime = new Date(Date.now() + 3600 * 1000);

    const contest = (
      await repo.upsertContest({
        externalId: 'cf-live-1',
        platform: 'codeforces',
        name: 'Codeforces Live Contest',
        url: 'https://codeforces.com/contest/live',
        startTime,
        endTime,
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await repo.scheduleNotification(contest.id, contest.startTime);

    // Setup Discord server
    await repo.upsertServer({
      guildId: 'test-guild-1',
      name: 'Test Server',
      timezone: 'UTC',
      startedChannelId: 'channel-started-1',
      enabled: true,
    });
    await repo.setServerPlatform('test-guild-1', 'codeforces', true);

    const mockSend = vi.fn().mockResolvedValue(true);
    const mockDiscord = {
      sendContestStarted: mockSend,
    } as unknown as DiscordClient;

    const result = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
      now: new Date(),
    });

    expect(result.status).toBe('sent');
    expect(result.recipientsCount).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Verify DB updated with sent_at
    const notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
    expect(notif?.sentAt).not.toBeNull();
  });

  it('should enforce idempotency and not send duplicate notifications on retry', async () => {
    const startTime = new Date(Date.now() - 5000);
    const endTime = new Date(Date.now() + 3600 * 1000);

    const contest = (
      await repo.upsertContest({
        externalId: 'cf-idem-1',
        platform: 'codeforces',
        name: 'Codeforces Idempotency Test',
        url: 'https://codeforces.com/contest/idem',
        startTime,
        endTime,
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await repo.scheduleNotification(contest.id, contest.startTime);

    await repo.upsertServer({
      guildId: 'test-guild-idem',
      timezone: 'UTC',
      startedChannelId: 'chan-idem',
      enabled: true,
    });

    const mockSend = vi.fn().mockResolvedValue(true);
    const mockDiscord = {
      sendContestStarted: mockSend,
    } as unknown as DiscordClient;

    // First execution
    const res1 = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
    });
    expect(res1.status).toBe('sent');
    expect(mockSend).toHaveBeenCalledTimes(1);

    // Second execution (simulate retry from async workload or duplicate invoke)
    const res2 = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
    });
    expect(res2.status).toBe('already_sent');
    // Crucial: sendContestStarted MUST NOT be called a second time
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should not send notification if contest is cancelled', async () => {
    const contest = (
      await repo.upsertContest({
        externalId: 'cf-cancelled-1',
        platform: 'codeforces',
        name: 'Cancelled Round',
        url: 'https://codeforces.com/contest/cancelled',
        startTime: new Date(Date.now() - 1000),
        endTime: new Date(Date.now() + 3600 * 1000),
        duration: 3600,
        status: 'CANCELLED',
      })
    ).contest;

    await repo.scheduleNotification(contest.id, contest.startTime);

    const mockSend = vi.fn();
    const mockDiscord = { sendContestStarted: mockSend } as unknown as DiscordClient;

    const result = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
    });

    expect(result.status).toBe('cancelled');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should detect rescheduled start time and defer notification instead of sending early', async () => {
    // Originally scheduled for now, but CLIST later pushed it 2 hours into the future
    const futureStartTime = new Date(Date.now() + 2 * 3600 * 1000);

    const contest = (
      await repo.upsertContest({
        externalId: 'cf-resched-1',
        platform: 'codeforces',
        name: 'Rescheduled Round',
        url: 'https://codeforces.com/contest/rescheduled',
        startTime: futureStartTime,
        endTime: new Date(futureStartTime.getTime() + 7200 * 1000),
        duration: 7200,
        status: 'SCHEDULED',
      })
    ).contest;

    const mockSend = vi.fn();
    const mockDiscord = { sendContestStarted: mockSend } as unknown as DiscordClient;

    // Workload awakens at the old time (Date.now())
    const result = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
      now: new Date(),
    });

    expect(result.status).toBe('rescheduled');
    expect(mockSend).not.toHaveBeenCalled();

    // Verify scheduled_for was updated in DB
    const notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
    expect(notif?.scheduledFor.toISOString()).toBe(futureStartTime.toISOString());
    expect(notif?.sentAt).toBeNull();
  });

  it('should respect server platform preferences', async () => {
    const contest = (
      await repo.upsertContest({
        externalId: 'lc-filter-1',
        platform: 'leetcode',
        name: 'LeetCode Weekly Contest',
        url: 'https://leetcode.com/contest/weekly',
        startTime: new Date(Date.now() - 1000),
        endTime: new Date(Date.now() + 3600 * 1000),
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await repo.scheduleNotification(contest.id, contest.startTime);

    // Server 1 only wants codeforces
    await repo.upsertServer({
      guildId: 'server-cf-only',
      timezone: 'UTC',
      startedChannelId: 'chan-cf',
      enabled: true,
    });
    await repo.setServerPlatform('server-cf-only', 'codeforces', true);

    // Server 2 wants leetcode
    await repo.upsertServer({
      guildId: 'server-lc-user',
      timezone: 'UTC',
      startedChannelId: 'chan-lc',
      enabled: true,
    });
    await repo.setServerPlatform('server-lc-user', 'leetcode', true);

    const mockSend = vi.fn().mockResolvedValue(true);
    const mockDiscord = { sendContestStarted: mockSend } as unknown as DiscordClient;

    const result = await executeContestStartNotification(contest.id, {
      repo,
      discordClient: mockDiscord,
    });

    expect(result.status).toBe('sent');
    expect(result.recipientsCount).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelId: 'chan-lc' })
    );
  });

  it('should unclaim notification and throw error if all Discord deliveries fail so QStash retries', async () => {
    const contest = (
      await repo.upsertContest({
        externalId: 'cf-fail-1',
        platform: 'codeforces',
        name: 'Codeforces Failing Round',
        url: 'https://codeforces.com/contest/fail',
        startTime: new Date(Date.now() - 1000), // started 1 sec ago
        endTime: new Date(Date.now() + 3600 * 1000),
        duration: 3600,
        status: 'SCHEDULED',
      })
    ).contest;

    await repo.upsertServer({
      guildId: 'server-failing',
      timezone: 'UTC',
      startedChannelId: 'chan-started',
      enabled: true,
    });

    const mockDiscord = {
      sendContestStarted: vi.fn().mockRejectedValue(new Error('Discord 500 Internal Error')),
    } as unknown as DiscordClient;

    await expect(
      executeContestStartNotification(contest.id, {
        repo,
        discordClient: mockDiscord,
      })
    ).rejects.toThrow('Failed to deliver notification to any destination');

    // Verify sent_at was un-claimed so subsequent retry succeeds
    const notif = await repo.getNotification(contest.id, 'CONTEST_STARTED');
    expect(notif?.sentAt).toBeNull();
  });
});


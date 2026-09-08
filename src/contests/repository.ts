import crypto from 'crypto';
import { DatabaseAdapter } from '../database/adapter.js';
import { getDatabaseAdapter } from '../database/connection.js';
import {
  Contest,
  ContestNotification,
  ContestStatus,
  NotificationType,
  ServerConfig,
  ServerPlatform,
  UpsertChangeType,
  UpsertContestResult,
} from './types.js';

export class ContestRepository {
  private db: DatabaseAdapter;

  constructor(db?: DatabaseAdapter) {
    this.db = db || getDatabaseAdapter();
  }

  private mapRowToContest(row: any): Contest {
    return {
      id: row.id,
      externalId: row.external_id,
      platform: row.platform,
      name: row.name,
      url: row.url,
      startTime: row.start_time instanceof Date ? row.start_time : new Date(row.start_time),
      endTime: row.end_time ? (row.end_time instanceof Date ? row.end_time : new Date(row.end_time)) : null,
      duration: row.duration !== null && row.duration !== undefined ? Number(row.duration) : null,
      status: row.status as ContestStatus,
      lastSyncedAt: row.last_synced_at instanceof Date ? row.last_synced_at : new Date(row.last_synced_at),
    };
  }

  private mapRowToNotification(row: any): ContestNotification {
    return {
      id: row.id,
      contestId: row.contest_id,
      notificationType: row.notification_type as NotificationType,
      scheduledFor: row.scheduled_for instanceof Date ? row.scheduled_for : new Date(row.scheduled_for),
      sentAt: row.sent_at ? (row.sent_at instanceof Date ? row.sent_at : new Date(row.sent_at)) : null,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  }

  async findById(id: string): Promise<Contest | null> {
    const row = await this.db.queryOne('SELECT * FROM contests WHERE id = $1', [id]);
    return row ? this.mapRowToContest(row) : null;
  }

  async findByExternalId(platform: string, externalId: string): Promise<Contest | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM contests WHERE platform = $1 AND external_id = $2',
      [platform, externalId]
    );
    return row ? this.mapRowToContest(row) : null;
  }

  async upsertContest(
    input: Omit<Contest, 'id' | 'lastSyncedAt'>,
    syncedAt: Date = new Date()
  ): Promise<UpsertContestResult> {
    const existing = await this.findByExternalId(input.platform, input.externalId);

    const id = existing ? existing.id : crypto.randomUUID();
    let changeType: UpsertChangeType = 'UNCHANGED';
    let oldStartTime: Date | undefined;

    if (!existing) {
      changeType = 'NEW';
    } else {
      oldStartTime = existing.startTime;
      if (existing.status !== 'CANCELLED' && input.status === 'CANCELLED') {
        changeType = 'CANCELLED';
      } else if (Math.abs(existing.startTime.getTime() - input.startTime.getTime()) > 1000) {
        changeType = 'RESCHEDULED';
      }
    }

    const rows = await this.db.query(
      `INSERT INTO contests (id, external_id, platform, name, url, start_time, end_time, duration, status, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (platform, external_id) DO UPDATE SET
         name = EXCLUDED.name,
         url = EXCLUDED.url,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         duration = EXCLUDED.duration,
         status = EXCLUDED.status,
         last_synced_at = EXCLUDED.last_synced_at
       RETURNING *`,
      [
        id,
        input.externalId,
        input.platform,
        input.name,
        input.url,
        input.startTime,
        input.endTime,
        input.duration,
        input.status,
        syncedAt,
      ]
    );

    return {
      contest: this.mapRowToContest(rows[0]),
      changeType,
      oldStartTime,
    };
  }

  async findContestsInWindow(
    startUtc: Date,
    endUtc: Date,
    platforms?: string[]
  ): Promise<Contest[]> {
    let sql = `
      SELECT * FROM contests
      WHERE start_time >= $1 AND start_time <= $2 AND status != 'CANCELLED'
    `;
    const params: any[] = [startUtc, endUtc];

    if (platforms && platforms.length > 0) {
      const placeholders = platforms.map((_, i) => `$${i + 3}`).join(', ');
      sql += ` AND platform IN (${placeholders})`;
      params.push(...platforms);
    }

    sql += ` ORDER BY start_time ASC`;

    const rows = await this.db.query(sql, params);
    return rows.map((r) => this.mapRowToContest(r));
  }

  async markMissingUpcomingAsCancelled(
    syncedBefore: Date,
    timeWindowStart: Date,
    timeWindowEnd: Date
  ): Promise<number> {
    const result = await this.db.execute(
      `UPDATE contests
       SET status = 'CANCELLED', last_synced_at = $1
       WHERE start_time >= $2 AND start_time <= $3
         AND last_synced_at < $4
         AND status = 'SCHEDULED'`,
      [new Date(), timeWindowStart, timeWindowEnd, syncedBefore]
    );
    return result.affectedRows;
  }

  // --- Notification Methods ---

  async getNotification(
    contestId: string,
    type: NotificationType = 'CONTEST_STARTED'
  ): Promise<ContestNotification | null> {
    const row = await this.db.queryOne(
      'SELECT * FROM contest_notifications WHERE contest_id = $1 AND notification_type = $2',
      [contestId, type]
    );
    return row ? this.mapRowToNotification(row) : null;
  }

  async scheduleNotification(
    contestId: string,
    scheduledFor: Date,
    type: NotificationType = 'CONTEST_STARTED'
  ): Promise<ContestNotification> {
    const now = new Date();
    const existing = await this.getNotification(contestId, type);

    if (!existing) {
      const id = crypto.randomUUID();
      const rows = await this.db.query(
        `INSERT INTO contest_notifications (id, contest_id, notification_type, scheduled_for, sent_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $6)
         ON CONFLICT (contest_id, notification_type) DO UPDATE SET
           scheduled_for = EXCLUDED.scheduled_for,
           updated_at = EXCLUDED.updated_at
         WHERE contest_notifications.sent_at IS NULL
         RETURNING *`,
        [id, contestId, type, scheduledFor, now, now]
      );
      return this.mapRowToNotification(rows[0]);
    }

    // If existing and not yet sent, update scheduled_for
    if (!existing.sentAt) {
      const rows = await this.db.query(
        `UPDATE contest_notifications
         SET scheduled_for = $1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [scheduledFor, now, existing.id]
      );
      return this.mapRowToNotification(rows[0]);
    }

    return existing;
  }

  /**
   * Atomic claim and mark notification as sent.
   * Returns true if successfully claimed by this caller, false if already sent.
   */
  async claimAndMarkNotificationSent(
    contestId: string,
    sentAt: Date = new Date(),
    type: NotificationType = 'CONTEST_STARTED'
  ): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE contest_notifications
       SET sent_at = $1, updated_at = $1
       WHERE contest_id = $2 AND notification_type = $3 AND sent_at IS NULL
       RETURNING id`,
      [sentAt, contestId, type]
    );

    return rows.length > 0;
  }

  // --- Server Methods ---

  async getAllServers(): Promise<ServerConfig[]> {
    const rows = await this.db.query('SELECT * FROM servers WHERE enabled = true');
    return rows.map((r) => ({
      guildId: r.guild_id,
      name: r.name,
      timezone: r.timezone,
      weeklyChannelId: r.weekly_channel_id,
      dailyChannelId: r.daily_channel_id,
      startedChannelId: r.started_channel_id,
      webhookUrl: r.webhook_url,
      enabled: r.enabled === true || r.enabled === 1,
    }));
  }

  async getServer(guildId: string): Promise<ServerConfig | null> {
    const r = await this.db.queryOne('SELECT * FROM servers WHERE guild_id = $1', [guildId]);
    if (!r) return null;
    return {
      guildId: r.guild_id,
      name: r.name,
      timezone: r.timezone,
      weeklyChannelId: r.weekly_channel_id,
      dailyChannelId: r.daily_channel_id,
      startedChannelId: r.started_channel_id,
      webhookUrl: r.webhook_url,
      enabled: r.enabled === true || r.enabled === 1,
    };
  }

  async upsertServer(server: ServerConfig): Promise<void> {
    await this.db.execute(
      `INSERT INTO servers (guild_id, name, timezone, weekly_channel_id, daily_channel_id, started_channel_id, webhook_url, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (guild_id) DO UPDATE SET
         name = EXCLUDED.name,
         timezone = EXCLUDED.timezone,
         weekly_channel_id = EXCLUDED.weekly_channel_id,
         daily_channel_id = EXCLUDED.daily_channel_id,
         started_channel_id = EXCLUDED.started_channel_id,
         webhook_url = EXCLUDED.webhook_url,
         enabled = EXCLUDED.enabled`,
      [
        server.guildId,
        server.name ?? null,
        server.timezone,
        server.weeklyChannelId ?? null,
        server.dailyChannelId ?? null,
        server.startedChannelId ?? null,
        server.webhookUrl ?? null,
        server.enabled,
      ]
    );
  }

  async getServerEnabledPlatforms(guildId: string): Promise<string[]> {
    const rows = await this.db.query(
      'SELECT platform FROM server_platforms WHERE guild_id = $1 AND enabled = true',
      [guildId]
    );
    return rows.map((r) => r.platform.toLowerCase());
  }

  async setServerPlatform(guildId: string, platform: string, enabled: boolean): Promise<void> {
    await this.db.execute(
      `INSERT INTO server_platforms (guild_id, platform, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, platform) DO UPDATE SET
         enabled = EXCLUDED.enabled`,
      [guildId, platform.toLowerCase(), enabled]
    );
  }
}

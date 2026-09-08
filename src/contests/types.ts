export type ContestStatus = 'SCHEDULED' | 'RUNNING' | 'FINISHED' | 'CANCELLED';

export interface Contest {
  id: string;
  externalId: string;
  platform: string;
  name: string;
  url: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null; // in seconds
  status: ContestStatus;
  lastSyncedAt: Date;
}

export type NotificationType = 'CONTEST_STARTED';

export interface ContestNotification {
  id: string;
  contestId: string;
  notificationType: NotificationType;
  scheduledFor: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerConfig {
  guildId: string;
  name?: string | null;
  timezone: string;
  weeklyChannelId?: string | null;
  dailyChannelId?: string | null;
  startedChannelId?: string | null;
  webhookUrl?: string | null;
  enabled: boolean;
}

export interface ServerPlatform {
  guildId: string;
  platform: string;
  enabled: boolean;
}

export type UpsertChangeType = 'NEW' | 'RESCHEDULED' | 'CANCELLED' | 'UNCHANGED';

export interface UpsertContestResult {
  contest: Contest;
  changeType: UpsertChangeType;
  oldStartTime?: Date;
}

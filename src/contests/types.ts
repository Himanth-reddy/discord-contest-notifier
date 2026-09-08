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

export interface PlatformInfo {
  id: string;
  name: string;
  description: string;
}

export const ALL_PLATFORMS: PlatformInfo[] = [
  { id: 'codeforces', name: 'Codeforces', description: 'Div 1/2/3/4 & Educational Rounds' },
  { id: 'codechef', name: 'CodeChef', description: 'Starters, Cook-Offs, Lunchtimes' },
  { id: 'leetcode', name: 'LeetCode', description: 'Weekly & Biweekly Contests' },
  { id: 'atcoder', name: 'AtCoder', description: 'Beginner (ABC), Regular (ARC), Grand (AGC)' },
  { id: 'hackerrank', name: 'HackerRank', description: 'HackerRank Contests' },
  { id: 'topcoder', name: 'TopCoder', description: 'Single Round Matches (SRM)' },
  { id: 'kaggle', name: 'Kaggle', description: 'ML & Data Science Competitions' },
  { id: 'geeksforgeeks', name: 'GeeksforGeeks', description: 'Weekly Contests & Bi-Wizard' },
];

export const DEFAULT_PLATFORMS: string[] = ['codeforces', 'codechef', 'leetcode'];

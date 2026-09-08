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
  alertRoleId?: string | null;
  digestHour?: number;
  lastDailyDigestAt?: Date | null;
  lastWeeklyDigestAt?: Date | null;
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

export interface PlatformRecord {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt?: Date;
}

export const DEFAULT_PLATFORMS: string[] = ['codeforces', 'codechef', 'leetcode'];

export const ALL_PLATFORMS: PlatformRecord[] = [
  { id: 'codeforces', name: 'Codeforces', description: 'Div 1/2/3/4 & Educational Rounds', isDefault: true },
  { id: 'codechef', name: 'CodeChef', description: 'Starters, Cook-Offs, Lunchtimes', isDefault: true },
  { id: 'leetcode', name: 'LeetCode', description: 'Weekly & Biweekly Contests', isDefault: true },
  { id: 'atcoder', name: 'AtCoder', description: 'Beginner (ABC), Regular (ARC), Grand (AGC)', isDefault: false },
  { id: 'hackerrank', name: 'HackerRank', description: 'Algorithms & Coding Challenges', isDefault: false },
  { id: 'hackerearth', name: 'HackerEarth', description: 'Circuits, Easy & Hackathons', isDefault: false },
  { id: 'topcoder', name: 'TopCoder', description: 'Single Round Matches (SRM)', isDefault: false },
  { id: 'geeksforgeeks', name: 'GeeksforGeeks', description: 'Weekly Contests & Bi-Wizard', isDefault: false },
  { id: 'kaggle', name: 'Kaggle', description: 'ML & Data Science Competitions', isDefault: false },
  { id: 'csacademy', name: 'CS Academy', description: 'Algorithms Rounds', isDefault: false },
  { id: 'dmoj', name: 'DMOJ', description: 'High School & Open Contests', isDefault: false },
  { id: 'luogu', name: 'Luogu (洛谷)', description: 'ICPC, Provincial & Open Contests', isDefault: false },
  { id: 'nowcoder', name: 'NowCoder (牛客网)', description: 'ACM & IOI Style Contests', isDefault: false },
  { id: 'ctftime', name: 'CTFtime', description: 'Capture The Flag Cybersecurity Contests', isDefault: false },
  { id: 'yukicoder', name: 'Yukicoder', description: 'Japanese Competitive Programming', isDefault: false },
  { id: 'toph', name: 'Toph', description: 'Bangladesh Programming Contests', isDefault: false },
];

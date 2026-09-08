import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  clist: {
    username: string;
    apiKey: string;
    baseUrl: string;
    rateLimitRequestsPerMinute: number;
  };
  database: {
    url: string;
    ssl: boolean;
  };
  discord: {
    botToken?: string;
    applicationId?: string;
    defaultStartedChannelId?: string;
    defaultDailyChannelId?: string;
    defaultWeeklyChannelId?: string;
    defaultWebhookUrl?: string;
  };
  defaultTimezone: string;
}

export const config: AppConfig = {
  clist: {
    username: process.env.CLIST_USERNAME || '',
    apiKey: process.env.CLIST_API_KEY || '',
    baseUrl: process.env.CLIST_BASE_URL || 'https://clist.by/api/v4',
    rateLimitRequestsPerMinute: parseInt(process.env.CLIST_RATE_LIMIT || '10', 10),
  },
  database: {
    url: process.env.DATABASE_URL || 'sqlite::memory:',
    ssl: process.env.DATABASE_SSL === 'true' || (process.env.DATABASE_URL?.includes('sslmode=require') ?? false),
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN,
    applicationId: process.env.DISCORD_APPLICATION_ID,
    defaultStartedChannelId: process.env.DEFAULT_STARTED_CHANNEL_ID,
    defaultDailyChannelId: process.env.DEFAULT_DAILY_CHANNEL_ID,
    defaultWeeklyChannelId: process.env.DEFAULT_WEEKLY_CHANNEL_ID,
    defaultWebhookUrl: process.env.DEFAULT_WEBHOOK_URL,
  },
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'UTC',
};

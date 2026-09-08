import { DatabaseAdapter } from './adapter.js';
import { getDatabaseAdapter } from './connection.js';
import { logger } from '../utils/logger.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS contests (
    id VARCHAR(64) PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL,
    platform VARCHAR(100) NOT NULL,
    name VARCHAR(500) NOT NULL,
    url TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration INT,
    status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    last_synced_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_contests_platform_external UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_contests_start_time ON contests(start_time);
CREATE INDEX IF NOT EXISTS idx_contests_platform ON contests(platform);
CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);

CREATE TABLE IF NOT EXISTS contest_notifications (
    id VARCHAR(64) PRIMARY KEY,
    contest_id VARCHAR(64) NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL DEFAULT 'CONTEST_STARTED',
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_notifications_contest_type UNIQUE (contest_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON contest_notifications(scheduled_for, sent_at);

CREATE TABLE IF NOT EXISTS servers (
    guild_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255),
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    weekly_channel_id VARCHAR(64),
    daily_channel_id VARCHAR(64),
    started_channel_id VARCHAR(64),
    webhook_url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS server_platforms (
    guild_id VARCHAR(64) NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (guild_id, platform)
);
`;

export async function runMigrations(adapter?: DatabaseAdapter): Promise<void> {
  const db = adapter || getDatabaseAdapter();
  logger.info('Running database migrations...');

  // Split queries by semicolon (ignoring empty lines)
  const statements = SCHEMA_SQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(statement);
  }

  logger.info('Database migrations completed successfully.');
}

// Allow direct execution: ts-node or node migrate.js
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => {
      logger.info('Migration complete.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration failed:', err);
      process.exit(1);
    });
}

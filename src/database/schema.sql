-- Contests table
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

-- Contest notifications table
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

-- Multi-server Discord configuration table
CREATE TABLE IF NOT EXISTS servers (
    guild_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255),
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    weekly_channel_id VARCHAR(64),
    daily_channel_id VARCHAR(64),
    started_channel_id VARCHAR(64),
    webhook_url TEXT,
    alert_role_id VARCHAR(64),
    digest_hour INT NOT NULL DEFAULT 8,
    last_daily_digest_at TIMESTAMPTZ,
    last_weekly_digest_at TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- Master table storing all available competitive programming platforms
CREATE TABLE IF NOT EXISTS platforms (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-server platform subscriptions
CREATE TABLE IF NOT EXISTS server_platforms (
    guild_id VARCHAR(64) NOT NULL REFERENCES servers(guild_id) ON DELETE CASCADE,
    platform VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (guild_id, platform)
);

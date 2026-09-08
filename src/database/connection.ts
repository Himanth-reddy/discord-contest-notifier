import { config } from '../config.js';
import { DatabaseAdapter, PostgresAdapter, SqliteAdapter } from './adapter.js';
import { logger } from '../utils/logger.js';

let defaultAdapter: DatabaseAdapter | null = null;

export function getDatabaseAdapter(): DatabaseAdapter {
  if (defaultAdapter) {
    return defaultAdapter;
  }

  const dbUrl = config.database.url;

  if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
    logger.info('Initializing PostgreSQL connection pool');
    defaultAdapter = new PostgresAdapter(dbUrl, config.database.ssl);
  } else if (dbUrl.startsWith('sqlite:')) {
    const filename = dbUrl.replace(/^sqlite:/, '') || ':memory:';
    logger.info(`Initializing SQLite database: ${filename}`);
    defaultAdapter = new SqliteAdapter(filename);
  } else {
    logger.info('Defaulting to in-memory SQLite database');
    defaultAdapter = new SqliteAdapter(':memory:');
  }

  return defaultAdapter;
}

export function setDatabaseAdapter(adapter: DatabaseAdapter | null): void {
  defaultAdapter = adapter;
}

import pg from 'pg';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ affectedRows: number }>;
  transaction<T>(callback: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool;

  constructor(connectionString: string, ssl: boolean = false) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected Postgres pool error', err);
    });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ affectedRows: number }> {
    const res = await this.pool.query(sql, params);
    return { affectedRows: res.rowCount ?? 0 };
  }

  async transaction<T>(callback: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter: DatabaseAdapter = {
        query: async <R = any>(sql: string, params: any[] = []) => {
          const res = await client.query(sql, params);
          return res.rows as R[];
        },
        queryOne: async <R = any>(sql: string, params: any[] = []) => {
          const rows = await client.query(sql, params);
          return rows.rows.length > 0 ? (rows.rows[0] as R) : null;
        },
        execute: async (sql: string, params: any[] = []) => {
          const res = await client.query(sql, params);
          return { affectedRows: res.rowCount ?? 0 };
        },
        transaction: async () => {
          throw new Error('Nested transactions not supported');
        },
        close: async () => {},
      };

      const result = await callback(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class SqliteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(filename: string = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  private formatParamValue(p: any): any {
    if (p instanceof Date) {
      return p.toISOString();
    }
    if (typeof p === 'boolean') {
      return p ? 1 : 0;
    }
    return p;
  }

  private transformParamsAndSql(sql: string, params: any[] = []): { preparedSql: string; formattedParams: any[] } {
    const formattedParams: any[] = [];
    const preparedSql = sql.replace(/\$(\d+)/g, (_, num) => {
      const index = parseInt(num, 10) - 1;
      const val = params[index];
      formattedParams.push(this.formatParamValue(val));
      return '?';
    });

    return { preparedSql, formattedParams };
  }

  private transformRow<T>(row: any): T {
    if (!row) return row;
    const transformed: any = { ...row };
    for (const [key, value] of Object.entries(transformed)) {
      if (
        (key.endsWith('_at') || key.endsWith('_time') || key === 'scheduled_for') &&
        typeof value === 'string'
      ) {
        transformed[key] = new Date(value);
      }
      if (key === 'enabled' && typeof value === 'number') {
        transformed[key] = value === 1;
      }
    }
    return transformed as T;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const { preparedSql, formattedParams } = this.transformParamsAndSql(sql, params);
    const stmt = this.db.prepare(preparedSql);
    const rows = stmt.all(...formattedParams);
    return rows.map((r) => this.transformRow<T>(r));
  }

  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const { preparedSql, formattedParams } = this.transformParamsAndSql(sql, params);
    const stmt = this.db.prepare(preparedSql);
    const row = stmt.get(...formattedParams);
    return row ? this.transformRow<T>(row) : null;
  }

  async execute(sql: string, params: any[] = []): Promise<{ affectedRows: number }> {
    const { preparedSql, formattedParams } = this.transformParamsAndSql(sql, params);
    const stmt = this.db.prepare(preparedSql);
    const info = stmt.run(...formattedParams);
    return { affectedRows: info.changes };
  }

  async transaction<T>(callback: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = await callback(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

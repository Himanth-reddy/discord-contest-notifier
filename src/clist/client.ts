import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ClistApiResponse, ClistRawContest, FetchContestsOptions, NormalizedContest } from './types.js';

export class ClistApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(`CLIST API error [${statusCode}]: ${message}`);
    this.name = 'ClistApiError';
  }
}

export class ClistClient {
  private username: string;
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options?: {
    username?: string;
    apiKey?: string;
    baseUrl?: string;
    fetchFn?: typeof fetch;
  }) {
    this.username = options?.username ?? config.clist.username;
    this.apiKey = options?.apiKey ?? config.clist.apiKey;
    this.baseUrl = (options?.baseUrl ?? config.clist.baseUrl).replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * Normalizes a raw CLIST contest resource/host to a clean platform slug.
   */
  public normalizePlatform(rawResource: string): string {
    const resource = (rawResource || '').toLowerCase().trim();
    if (resource.includes('codeforces')) return 'codeforces';
    if (resource.includes('leetcode')) return 'leetcode';
    if (resource.includes('atcoder')) return 'atcoder';
    if (resource.includes('codechef')) return 'codechef';
    if (resource.includes('hackerrank')) return 'hackerrank';
    if (resource.includes('hackerearth')) return 'hackerearth';
    if (resource.includes('topcoder')) return 'topcoder';
    if (resource.includes('kaggle')) return 'kaggle';
    if (resource.includes('geeksforgeeks')) return 'geeksforgeeks';
    if (resource.includes('csacademy')) return 'csacademy';
    if (resource.includes('dmoj')) return 'dmoj';
    if (resource.includes('luogu')) return 'luogu';
    if (resource.includes('nowcoder') || resource === 'ac' || resource.includes('ac.nowcoder')) return 'nowcoder';
    if (resource.includes('ctftime')) return 'ctftime';
    if (resource.includes('yukicoder')) return 'yukicoder';
    if (resource.includes('toph')) return 'toph';

    return resource.split('.')[0] || resource;
  }

  /**
   * Parses CLIST date strings into canonical UTC Date instances.
   */
  public parseUtcDate(dateStr?: string | null): Date | null {
    if (!dateStr) return null;
    let clean = dateStr.trim().replace(' ', 'T');
    if (!clean.endsWith('Z') && !clean.includes('+') && !clean.match(/-\d{2}:\d{2}$/)) {
      clean += 'Z';
    }
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Normalizes a raw CLIST contest object into our internal Contest entity representation.
   */
  public normalizeContest(raw: ClistRawContest): NormalizedContest | null {
    const startTime = this.parseUtcDate(raw.start);
    if (!startTime) {
      logger.warn(`Skipping CLIST contest with invalid start time: ${raw.event} (id: ${raw.id})`);
      return null;
    }

    const endTime = this.parseUtcDate(raw.end);
    const platform = this.normalizePlatform(raw.resource || raw.host || '');
    let duration = raw.duration ? Number(raw.duration) : null;

    if (!duration && endTime) {
      duration = Math.max(0, Math.floor((endTime.getTime() - startTime.getTime()) / 1000));
    }

    return {
      externalId: String(raw.id),
      platform,
      name: raw.event.trim(),
      url: raw.href,
      startTime,
      endTime,
      duration,
    };
  }

  /**
   * Fetches contests from CLIST API with automatic retry and rate-limit backoff.
   */
  async fetchContests(options: FetchContestsOptions = {}): Promise<NormalizedContest[]> {
    const url = new URL(`${this.baseUrl}/contest/`);

    url.searchParams.set('order_by', 'start');
    url.searchParams.set('limit', String(options.limit ?? 100));
    if (options.offset) {
      url.searchParams.set('offset', String(options.offset));
    }

    if (options.upcoming) {
      url.searchParams.set('upcoming', 'true');
    }
    if (options.startGte) {
      url.searchParams.set('start__gte', options.startGte.toISOString());
    }
    if (options.startLte) {
      url.searchParams.set('start__lte', options.startLte.toISOString());
    }
    if (options.endGte) {
      url.searchParams.set('end__gte', options.endGte.toISOString());
    }
    if (options.resources && options.resources.length > 0) {
      url.searchParams.set('resource__in', options.resources.join(','));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.username && this.apiKey) {
      headers['Authorization'] = `ApiKey ${this.username}:${this.apiKey}`;
    }

    let maxRetries = 3;
    let delay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(url.toString(), {
          method: 'GET',
          headers,
        });

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const waitTime = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : delay;
          logger.warn(`CLIST rate limit hit (429). Retrying in ${waitTime}ms (attempt ${attempt}/${maxRetries})`);
          if (attempt === maxRetries) {
            throw new ClistApiError(429, 'Rate limit exceeded and max retries reached');
          }
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          delay *= 2;
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new ClistApiError(response.status, errorBody || response.statusText);
        }

        const data = (await response.json()) as ClistApiResponse;
        const normalizedList: NormalizedContest[] = [];

        for (const raw of data.objects || []) {
          const normalized = this.normalizeContest(raw);
          if (normalized) {
            normalizedList.push(normalized);
          }
        }

        return normalizedList;
      } catch (err) {
        if (err instanceof ClistApiError && err.statusCode === 429) {
          throw err;
        }
        if (attempt === maxRetries) {
          logger.error(`CLIST API request failed after ${maxRetries} attempts`, err);
          throw err;
        }
        logger.warn(`CLIST API request failed (attempt ${attempt}/${maxRetries}). Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    return [];
  }
}

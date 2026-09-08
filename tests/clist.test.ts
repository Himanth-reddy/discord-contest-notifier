import { describe, it, expect, vi } from 'vitest';
import { ClistClient, ClistApiError } from '../src/clist/client.js';
import { ClistApiResponse } from '../src/clist/types.js';

describe('CLIST API Client', () => {
  it('should normalize platform slugs correctly', () => {
    const client = new ClistClient();
    expect(client.normalizePlatform('codeforces.com')).toBe('codeforces');
    expect(client.normalizePlatform('leetcode.com')).toBe('leetcode');
    expect(client.normalizePlatform('atcoder.jp')).toBe('atcoder');
    expect(client.normalizePlatform('codechef.com')).toBe('codechef');
    expect(client.normalizePlatform('custom-judge.org')).toBe('custom-judge');
  });

  it('should parse UTC dates correctly regardless of format', () => {
    const client = new ClistClient();
    const d1 = client.parseUtcDate('2026-09-10T14:35:00');
    expect(d1?.toISOString()).toBe('2026-09-10T14:35:00.000Z');

    const d2 = client.parseUtcDate('2026-09-10 14:35:00');
    expect(d2?.toISOString()).toBe('2026-09-10T14:35:00.000Z');

    const d3 = client.parseUtcDate('2026-09-10T14:35:00Z');
    expect(d3?.toISOString()).toBe('2026-09-10T14:35:00.000Z');

    expect(client.parseUtcDate(null)).toBeNull();
    expect(client.parseUtcDate('invalid-date')).toBeNull();
  });

  it('should normalize a raw CLIST contest object', () => {
    const client = new ClistClient();
    const normalized = client.normalizeContest({
      id: 998877,
      event: 'Weekly Contest 450',
      resource: 'leetcode.com',
      start: '2026-09-12T02:30:00',
      end: '2026-09-12T04:00:00',
      duration: 5400,
      href: 'https://leetcode.com/contest/weekly-contest-450/',
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.externalId).toBe('998877');
    expect(normalized?.platform).toBe('leetcode');
    expect(normalized?.name).toBe('Weekly Contest 450');
    expect(normalized?.startTime.toISOString()).toBe('2026-09-12T02:30:00.000Z');
    expect(normalized?.endTime?.toISOString()).toBe('2026-09-12T04:00:00.000Z');
    expect(normalized?.duration).toBe(5400);
  });

  it('should calculate duration from start and end time if duration is missing', () => {
    const client = new ClistClient();
    const normalized = client.normalizeContest({
      id: 1122,
      event: 'AtCoder Beginner Contest 350',
      resource: 'atcoder.jp',
      start: '2026-09-12T12:00:00Z',
      end: '2026-09-12T13:40:00Z',
      href: 'https://atcoder.jp/contests/abc350',
    });

    expect(normalized?.duration).toBe(6000); // 100 minutes = 6000s
  });

  it('should fetch and parse contests via mocked fetch', async () => {
    const mockApiResponse: ClistApiResponse = {
      meta: { limit: 100, next: null, offset: 0, previous: null, total_count: 1 },
      objects: [
        {
          id: 554433,
          event: 'Codeforces Round 1050',
          resource: 'codeforces.com',
          start: '2026-09-15T14:35:00Z',
          end: '2026-09-15T16:50:00Z',
          duration: 8100,
          href: 'https://codeforces.com/contest/1050',
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    });

    const client = new ClistClient({
      username: 'test_user',
      apiKey: 'test_key',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const contests = await client.fetchContests({ upcoming: true });
    expect(contests.length).toBe(1);
    expect(contests[0].name).toBe('Codeforces Round 1050');
    expect(contests[0].platform).toBe('codeforces');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify Auth header was passed
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['Authorization']).toBe('ApiKey test_user:test_key');
  });

  it('should retry when 429 rate limit is encountered', async () => {
    const mockApiResponse: ClistApiResponse = {
      meta: { limit: 100, next: null, offset: 0, previous: null, total_count: 0 },
      objects: [],
    };

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '0' }),
          text: async () => 'Rate limit exceeded',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockApiResponse,
      };
    });

    const client = new ClistClient({
      username: 'test_user',
      apiKey: 'test_key',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const contests = await client.fetchContests();
    expect(callCount).toBe(2);
    expect(contests).toEqual([]);
  });
});

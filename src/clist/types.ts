export interface ClistRawContest {
  id: number | string;
  event: string;
  resource: string;
  resource_id?: number;
  host?: string;
  start: string;
  end?: string | null;
  duration?: number | null;
  href: string;
  parsed_at?: string;
}

export interface ClistApiResponse {
  meta: {
    limit: number;
    next: string | null;
    offset: number;
    previous: string | null;
    total_count: number;
  };
  objects: ClistRawContest[];
}

export interface NormalizedContest {
  externalId: string;
  platform: string;
  name: string;
  url: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null; // seconds
}

export interface FetchContestsOptions {
  upcoming?: boolean;
  startGte?: Date;
  startLte?: Date;
  endGte?: Date;
  resources?: string[];
  limit?: number;
  offset?: number;
}

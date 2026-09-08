export const CONTEST_START_EVENT = 'contest:start-notification';

export interface ContestStartEventData {
  contestId: string;
  scheduledStartTime: string; // ISO string in UTC
}

export interface WorkloadDispatcher {
  send(eventName: string, options?: { data?: any; delayUntil?: number | string }): Promise<{ sendStatus: string; eventId?: string }>;
}

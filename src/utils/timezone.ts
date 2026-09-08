import { toZonedTime, format as formatTz } from 'date-fns-tz';
import { format as formatLocal } from 'date-fns';

/**
 * Format a UTC Date into a formatted string in the specified IANA timezone.
 * Example format: "yyyy-MM-dd HH:mm zzz" or "HH:mm"
 */
export function formatInServerTimezone(
  date: Date,
  timezone: string,
  formatPattern: string = 'yyyy-MM-dd HH:mm zzz'
): string {
  try {
    const zonedDate = toZonedTime(date, timezone);
    return formatTz(zonedDate, formatPattern, { timeZone: timezone });
  } catch {
    // Fallback to UTC if timezone is invalid
    const zonedDate = toZonedTime(date, 'UTC');
    return formatTz(zonedDate, formatPattern, { timeZone: 'UTC' });
  }
}

/**
 * Formats a duration in seconds into human-readable text (e.g. "2h 15m", "45m", "1d 2h").
 */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return 'Unknown duration';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : `${seconds}s`;
}

/**
 * Returns Discord formatted timestamp tag:
 * - 'R': Relative (e.g. "in 2 hours", "4 minutes ago")
 * - 'F': Full date and time (e.g. "Wednesday, September 10, 2026 7:00 PM")
 * - 't': Short time (e.g. "19:00")
 */
export function getDiscordTimestamp(date: Date, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'F'): string {
  const epochSeconds = Math.floor(date.getTime() / 1000);
  return `<t:${epochSeconds}:${style}>`;
}

/**
 * Calculate the UTC date range for a single local calendar day in the given timezone.
 * Returns { startUtc, endUtc } representing 00:00:00.000 to 23:59:59.999 in that timezone.
 */
export function getServerDayBounds(referenceDate: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  // Get date parts in target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  // Find start and end by binary searching or offsetting
  // A clean approach: create candidate UTC dates and check in target timezone
  const approxStart = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  });
  
  // Calculate timezone offset at approx start
  const tzParts = offsetFormatter.formatToParts(approxStart);
  const offsetPart = tzParts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const offsetMinutes = parseOffsetToMinutes(offsetPart);

  const startUtc = new Date(approxStart.getTime() - offsetMinutes * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { startUtc, endUtc };
}

/**
 * Calculate the UTC date range for the next 7 days in the given timezone.
 */
export function getServerWeekBounds(referenceDate: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const { startUtc } = getServerDayBounds(referenceDate, timezone);
  const endUtc = new Date(startUtc.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { startUtc, endUtc };
}

function parseOffsetToMinutes(offsetStr: string): number {
  const match = offsetStr.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/**
 * Gets the current hour (0-23) in the specified timezone.
 */
export function getLocalHour(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(date), 10);
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Gets the current day of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday) in the specified timezone.
 */
export function getLocalDayOfWeek(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayStr = formatter.format(date);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[dayStr] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

/**
 * Checks if two dates fall on the same calendar day in the given timezone.
 */
export function isSameLocalDay(dateA: Date, dateB: Date, timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateA) === formatter.format(dateB);
  } catch {
    return dateA.toISOString().slice(0, 10) === dateB.toISOString().slice(0, 10);
  }
}

/**
 * Determines whether a daily digest is due for a server in its timezone.
 * Returns true if the current local hour matches targetHour (default 8)
 * and no digest has been sent yet on this local calendar day.
 */
export function isServerDailyDigestDue(
  timezone: string,
  lastSentAt: Date | null | undefined,
  targetHour: number = 8,
  now: Date = new Date()
): boolean {
  const localHour = getLocalHour(now, timezone);
  if (localHour !== targetHour) {
    return false;
  }
  if (lastSentAt && isSameLocalDay(lastSentAt, now, timezone)) {
    return false;
  }
  return true;
}

/**
 * Determines whether a weekly digest is due for a server in its timezone.
 * Returns true if today is Monday (1), the current local hour matches targetHour (default 8),
 * and no weekly digest has been sent yet within the last 5 days.
 */
export function isServerWeeklyDigestDue(
  timezone: string,
  lastSentAt: Date | null | undefined,
  targetHour: number = 8,
  targetDayOfWeek: number = 1, // 1 = Monday
  now: Date = new Date()
): boolean {
  const localDayOfWeek = getLocalDayOfWeek(now, timezone);
  if (localDayOfWeek !== targetDayOfWeek) {
    return false;
  }
  const localHour = getLocalHour(now, timezone);
  if (localHour !== targetHour) {
    return false;
  }
  if (lastSentAt) {
    const diffMs = now.getTime() - lastSentAt.getTime();
    if (diffMs < 5 * 24 * 60 * 60 * 1000) {
      return false;
    }
  }
  return true;
}

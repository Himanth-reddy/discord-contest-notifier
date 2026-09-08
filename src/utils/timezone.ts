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

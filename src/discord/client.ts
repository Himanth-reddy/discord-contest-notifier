import { config } from '../config.js';
import { Contest } from '../contests/types.js';
import { logger } from '../utils/logger.js';
import {
  formatContestStartedMessage,
  formatDailyDigestMessage,
  formatWeeklyDigestMessage,
} from './formatter.js';
import { DiscordDestination, DiscordMessagePayload } from './types.js';

export class DiscordApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(`Discord API Error [${statusCode}]: ${message}`);
    this.name = 'DiscordApiError';
  }
}

export class DiscordClient {
  private botToken?: string;
  private fetchFn: typeof fetch;

  constructor(options?: { botToken?: string; fetchFn?: typeof fetch }) {
    this.botToken = options?.botToken ?? config.discord.botToken;
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * Dispatches a formatted payload to the specified Discord destination
   * (either a Discord Webhook URL or a Discord Channel ID via REST API).
   */
  async sendMessage(payload: DiscordMessagePayload, destination: DiscordDestination): Promise<boolean> {
    let targetUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (destination.webhookUrl) {
      targetUrl = destination.webhookUrl;
    } else if (destination.channelId) {
      if (!this.botToken) {
        throw new Error('Cannot send message to Discord channel: DISCORD_BOT_TOKEN is not configured');
      }
      targetUrl = `https://discord.com/api/v10/channels/${destination.channelId}/messages`;
      headers['Authorization'] = `Bot ${this.botToken}`;
    } else {
      logger.warn('No channelId or webhookUrl provided for Discord destination. Message skipped.');
      return false;
    }

    const maxRetries = 3;
    let delay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (response.status === 429) {
          const body = (await response.json().catch(() => ({}))) as any;
          const retryAfterSec = body.retry_after ?? parseFloat(response.headers.get('Retry-After') || '1');
          const waitMs = Math.ceil(retryAfterSec * 1000) || delay;

          logger.warn(`Discord rate limit hit (429). Retrying in ${waitMs}ms (attempt ${attempt}/${maxRetries})`);
          if (attempt === maxRetries) {
            throw new DiscordApiError(429, 'Discord rate limit exceeded and max retries reached');
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          delay *= 2;
          continue;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new DiscordApiError(response.status, errText || response.statusText);
        }

        return true;
      } catch (err) {
        if (err instanceof DiscordApiError && err.statusCode !== 429) {
          logger.error('Discord API non-retryable error', err);
          throw err;
        }
        if (attempt === maxRetries) {
          logger.error(`Discord API delivery failed after ${maxRetries} attempts`, err);
          throw err;
        }
        logger.warn(`Discord API request failed (attempt ${attempt}/${maxRetries}). Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    return false;
  }

  async sendContestStarted(contest: Contest, destination: DiscordDestination): Promise<boolean> {
    const tz = destination.timezone || config.defaultTimezone;
    const payload = formatContestStartedMessage(contest, tz);
    logger.info(`Sending contest start notification for ${contest.name} (${contest.id}) to Discord`);
    return this.sendMessage(payload, destination);
  }

  async sendDailyDigest(contests: Contest[], destination: DiscordDestination): Promise<boolean> {
    const tz = destination.timezone || config.defaultTimezone;
    const payload = formatDailyDigestMessage(contests, tz);
    logger.info(`Sending daily digest (${contests.length} contests) to Discord`);
    return this.sendMessage(payload, destination);
  }

  async sendWeeklyDigest(contests: Contest[], destination: DiscordDestination): Promise<boolean> {
    const tz = destination.timezone || config.defaultTimezone;
    const payload = formatWeeklyDigestMessage(contests, tz);
    logger.info(`Sending weekly digest (${contests.length} contests) to Discord`);
    return this.sendMessage(payload, destination);
  }
}

import { sleep as defaultSleep } from './util.js';

/** Settings of {@link RetryPolicy}. All durations are in milliseconds. */
export interface RetryPolicyOptions {
  /** First backoff delay before jitter. Default 500. */
  initialDelay?: number;
  /** Largest backoff delay before jitter. Default 8000. */
  maxDelay?: number;
  /** Largest delay accepted from a `Retry-After` header. Default 60000. */
  maxRetryAfter?: number;
  /** Replaces the timer, e.g. in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1); replaces `Math.random` for the jitter, e.g. in tests. */
  random?: () => number;
}

const NEVER_RETRY_CODES = new Set(['delivery_failed', 'feature_unavailable']);

/**
 * Decides which failures are retried and how long to wait.
 *
 * Retried: connection errors and timeouts, `429 too_many_requests`, `409 idempotency_in_progress`,
 * `500`, `502` (except `delivery_failed`), `503` (except `feature_unavailable`) and `504`.
 * The delay honours `Retry-After` (capped) or uses exponential backoff with jitter.
 */
export class RetryPolicy {
  readonly initialDelay: number;
  readonly maxDelay: number;
  readonly maxRetryAfter: number;
  private readonly sleeper: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: RetryPolicyOptions = {}) {
    this.initialDelay = options.initialDelay ?? 500;
    this.maxDelay = options.maxDelay ?? 8000;
    this.maxRetryAfter = options.maxRetryAfter ?? 60_000;
    this.sleeper = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /**
   * Whether a failed attempt may be retried. `status` is null for connection errors (no HTTP response).
   */
  shouldRetry(status: number | null, errorCode: string | null): boolean {
    if (status === null) return true;
    if (errorCode !== null && NEVER_RETRY_CODES.has(errorCode)) return false;
    switch (status) {
      case 429:
        return errorCode === null || errorCode === 'too_many_requests';
      case 409:
        return errorCode === 'idempotency_in_progress';
      case 500:
      case 502:
      case 503:
      case 504:
        return true;
      default:
        return false;
    }
  }

  /** Delay in milliseconds before retry number `attempt + 1` (`attempt` starts at 0). */
  delay(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader !== null) {
      const trimmed = retryAfterHeader.trim();
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return Math.min(this.maxRetryAfter, Math.max(0, Number(trimmed) * 1000));
      }
    }
    const base = Math.min(this.maxDelay, this.initialDelay * 2 ** attempt);
    return base / 2 + (base / 2) * this.random();
  }

  sleep(ms: number): Promise<void> {
    return this.sleeper(ms);
  }
}

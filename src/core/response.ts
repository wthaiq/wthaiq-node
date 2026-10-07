/** HTTP metadata of the call that produced a response object. */
export class ResponseMeta {
  /** HTTP status code. */
  readonly statusCode: number;
  /** Response headers with lower-case names. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode;
    this.headers = Object.freeze({ ...headers });
  }

  /** Returns a header (case-insensitive) or null. */
  getHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  /** The `Wthaiq-Request-Id` of the call (`req_…`). Quote it to support. */
  get requestId(): string | null {
    return this.getHeader('wthaiq-request-id');
  }

  /** The API version that answered (`Wthaiq-Version`). */
  get apiVersion(): string | null {
    return this.getHeader('wthaiq-version');
  }

  /** True when the response is a stored replay of an earlier request with the same idempotency key. */
  get idempotentReplayed(): boolean {
    return this.getHeader('idempotent-replayed')?.toLowerCase() === 'true';
  }

  /** The per-account rate limit window, when the API sent it. */
  get rateLimit(): { limit: number; remaining: number; reset: number } | null {
    const limit = this.getHeader('x-ratelimit-limit');
    const remaining = this.getHeader('x-ratelimit-remaining');
    const reset = this.getHeader('x-ratelimit-reset');
    if (limit === null || remaining === null || reset === null) return null;
    return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) };
  }

  toJSON(): { statusCode: number; headers: Readonly<Record<string, string>> } {
    return { statusCode: this.statusCode, headers: this.headers };
  }
}

/**
 * A decoded API object with the HTTP metadata of its call in the non-enumerable `lastResponse` property
 * (left out of `JSON.stringify` and object spread).
 */
export type WthaiqResponse<T> = T & { readonly lastResponse: ResponseMeta };

/** @internal */
export function attachResponse<T extends object>(value: T, meta: ResponseMeta): WthaiqResponse<T> {
  Object.defineProperty(value, 'lastResponse', {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return value as WthaiqResponse<T>;
}

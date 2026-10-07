import {
  ApiConnectionError,
  ApiError,
  errorFromResponse,
  InvalidArgumentError,
  isRecord,
  UnexpectedResponseError,
} from './errors.js';
import { attachResponse, ResponseMeta, type WthaiqResponse } from './response.js';
import type { RetryPolicy } from './retry.js';
import { encodeJson, encodeQuery, uuidV4 } from './util.js';

/** Options accepted as the last argument of every resource method. */
export interface RequestOptions {
  /** Idempotency key for `POST` requests. A random UUID is generated when omitted. */
  idempotencyKey?: string;
  /** Total time allowed for each attempt, in milliseconds. Overrides the client `timeout`. */
  timeout?: number;
  /** Automatic retries for this call. Overrides the client `maxRetries`. */
  maxRetries?: number;
  /** Extra request headers. `Authorization` is refused: use `apiKey`. */
  headers?: Record<string, string>;
  /** Use another API key for this call only. */
  apiKey?: string;
  /** Cancels the call (and any pending retry) when aborted. */
  signal?: AbortSignal;
}

const REQUEST_OPTION_KEYS = new Set([
  'idempotencyKey',
  'timeout',
  'maxRetries',
  'headers',
  'apiKey',
  'signal',
]);

/** Minimal `Headers` shape used by this library. */
export interface FetchHeadersLike {
  forEach(callback: (value: string, key: string) => void): void;
}

/** Minimal `Response` shape used by this library. */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: FetchHeadersLike;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly body?: ReadableStream<Uint8Array> | null;
}

/** The request passed to {@link FetchLike}. */
export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  signal: AbortSignal;
  redirect: 'manual';
}

/** A `fetch`-compatible function. The global `fetch` is used by default. */
export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

/** @internal */
export interface RequestorConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  apiVersion: string;
  userAgent: string;
  fetch: FetchLike | undefined;
  retryPolicy: RetryPolicy;
}

/** @internal */
export interface RawResponse<T> {
  statusCode: number;
  headers: Record<string, string>;
  body: T;
}

type ReadMode = 'text' | 'bytes' | 'stream';

interface RequestSpec {
  method: string;
  path: string;
  query?: object | undefined;
  json?: unknown;
  body?: { bytes: Uint8Array; contentType: string } | undefined;
  accept?: string;
}

/**
 * Sends HTTP requests with authentication, versioning, idempotency keys, timeouts and retries.
 *
 * @internal
 */
export class Requestor {
  constructor(private readonly config: RequestorConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /** Sends a request and decodes the JSON response object. */
  async json<T extends object>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: object | undefined,
    options: RequestOptions | undefined,
  ): Promise<WthaiqResponse<T>> {
    const spec: RequestSpec =
      method === 'POST' ? { method, path, json: params ?? {} } : { method, path, query: params };
    const raw = await this.send(spec, options, 'text');
    return attachResponse(decodeObject<T>(raw), new ResponseMeta(raw.statusCode, raw.headers));
  }

  /** Sends a pre-encoded body (multipart upload) and decodes the JSON response object. */
  async jsonWithBody<T extends object>(
    path: string,
    body: { bytes: Uint8Array; contentType: string },
    options: RequestOptions | undefined,
  ): Promise<WthaiqResponse<T>> {
    const raw = await this.send({ method: 'POST', path, body }, options, 'text');
    return attachResponse(decodeObject<T>(raw), new ResponseMeta(raw.statusCode, raw.headers));
  }

  /** Sends a GET request and returns the body as bytes. */
  bytes(path: string, options: RequestOptions | undefined, accept: string): Promise<RawResponse<Uint8Array>> {
    return this.send({ method: 'GET', path, accept }, options, 'bytes');
  }

  /** Sends a GET request and returns the body as a stream. */
  stream(
    path: string,
    options: RequestOptions | undefined,
    accept: string,
  ): Promise<RawResponse<ReadableStream<Uint8Array> | null>> {
    return this.send({ method: 'GET', path, accept }, options, 'stream');
  }

  private async send(
    spec: RequestSpec,
    options: RequestOptions | undefined,
    mode: 'text',
  ): Promise<RawResponse<string>>;
  private async send(
    spec: RequestSpec,
    options: RequestOptions | undefined,
    mode: 'bytes',
  ): Promise<RawResponse<Uint8Array>>;
  private async send(
    spec: RequestSpec,
    options: RequestOptions | undefined,
    mode: 'stream',
  ): Promise<RawResponse<ReadableStream<Uint8Array> | null>>;
  private async send(
    spec: RequestSpec,
    rawOptions: RequestOptions | undefined,
    mode: ReadMode,
  ): Promise<RawResponse<string | Uint8Array | ReadableStream<Uint8Array> | null>> {
    const options = parseRequestOptions(rawOptions);
    const fetchFn = this.config.fetch ?? defaultFetch();
    const timeout = options.timeout ?? this.config.timeout;
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const policy = this.config.retryPolicy;

    let url = this.config.baseUrl + spec.path;
    if (spec.query !== undefined) {
      const query = encodeQuery(spec.query);
      if (query !== '') url += (url.includes('?') ? '&' : '?') + query;
    }

    let headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey ?? this.config.apiKey}`,
      'User-Agent': this.config.userAgent,
      'Wthaiq-Version': this.config.apiVersion,
      Accept: spec.accept ?? 'application/json',
    };
    let body: string | Uint8Array | undefined;
    if (spec.body !== undefined) {
      body = spec.body.bytes;
      headers['Content-Type'] = spec.body.contentType;
    } else if (spec.method === 'POST') {
      body = encodeJson(spec.json);
      headers['Content-Type'] = 'application/json';
    }
    if (spec.method === 'POST') {
      headers['Idempotency-Key'] = options.idempotencyKey ?? (await uuidV4());
    }
    const custom = Object.entries(options.headers ?? {});
    if (custom.length > 0) {
      const overridden = new Set(custom.map(([name]) => name.toLowerCase()));
      headers = Object.fromEntries([
        ...Object.entries(headers).filter(([name]) => !overridden.has(name.toLowerCase())),
        ...custom,
      ]);
    }

    for (let attempt = 0; ; attempt++) {
      const outcome = await this.attempt(
        fetchFn,
        url,
        spec.method,
        headers,
        body,
        timeout,
        options.signal,
        mode,
      );
      if (outcome.ok) return outcome.response;
      const error = outcome.error;
      const status = error instanceof ApiError ? error.statusCode : null;
      const code = error instanceof ApiError ? error.code : null;
      const retryable = error instanceof ApiError || (error instanceof ApiConnectionError && !error.aborted);
      if (!retryable || attempt >= maxRetries || !policy.shouldRetry(status, code)) throw error;
      const retryAfter = error instanceof ApiError ? error.getHeader('retry-after') : null;
      await policy.sleep(policy.delay(attempt, retryAfter));
      if (options.signal?.aborted === true) {
        throw new ApiConnectionError('The request was aborted by the caller.', {
          aborted: true,
          cause: options.signal.reason,
        });
      }
    }
  }

  private async attempt(
    fetchFn: FetchLike,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | Uint8Array | undefined,
    timeout: number,
    signal: AbortSignal | undefined,
    mode: ReadMode,
  ): Promise<
    | { ok: true; response: RawResponse<string | Uint8Array | ReadableStream<Uint8Array> | null> }
    | { ok: false; error: WthaiqErrorLike }
  > {
    if (signal?.aborted === true) {
      return {
        ok: false,
        error: new ApiConnectionError('The request was aborted by the caller.', {
          aborted: true,
          cause: signal.reason,
        }),
      };
    }
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    let keepListener = false;

    const connectionError = (cause: unknown): ApiConnectionError => {
      if (timedOut) {
        return new ApiConnectionError(`The request to the Wthaiq API timed out after ${timeout} ms.`, {
          timedOut: true,
          cause,
        });
      }
      if (signal?.aborted === true) {
        return new ApiConnectionError('The request was aborted by the caller.', { aborted: true, cause });
      }
      const detail = cause instanceof Error ? describeCause(cause) : String(cause);
      return new ApiConnectionError(`Could not connect to the Wthaiq API (${url.split('?')[0]}): ${detail}`, {
        cause,
      });
    };

    try {
      const init: FetchRequestInit = { method, headers, signal: controller.signal, redirect: 'manual' };
      if (body !== undefined) init.body = body;
      let res: FetchResponseLike;
      try {
        res = await fetchFn(url, init);
      } catch (cause) {
        return { ok: false, error: connectionError(cause) };
      }
      const resHeaders = normalizeHeaders(res.headers);
      try {
        if (res.status >= 200 && res.status < 300) {
          if (mode === 'stream') {
            keepListener = true;
            return {
              ok: true,
              response: { statusCode: res.status, headers: resHeaders, body: res.body ?? null },
            };
          }
          const payload = mode === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
          return { ok: true, response: { statusCode: res.status, headers: resHeaders, body: payload } };
        }
        const text = await res.text();
        return { ok: false, error: errorFromResponse(res.status, resHeaders, text) };
      } catch (cause) {
        return { ok: false, error: connectionError(cause) };
      }
    } finally {
      clearTimeout(timer);
      if (!keepListener) signal?.removeEventListener('abort', onAbort);
    }
  }
}

type WthaiqErrorLike = ApiError | ApiConnectionError;

function describeCause(error: Error): string {
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message !== '' && cause.message !== error.message) {
    return `${error.message} (${cause.message})`;
  }
  return error.message;
}

function normalizeHeaders(headers: FetchHeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function defaultFetch(): FetchLike {
  const fn = (globalThis as { fetch?: unknown }).fetch;
  if (typeof fn !== 'function') {
    throw new InvalidArgumentError(
      'No global fetch is available. Use Node.js 18 or later, or pass a fetch implementation in the "fetch" option.',
    );
  }
  return fn.bind(globalThis) as FetchLike;
}

function decodeObject<T>(raw: RawResponse<string>): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.body);
  } catch (cause) {
    throw new UnexpectedResponseError(
      `The Wthaiq API returned a response that is not valid JSON (HTTP ${raw.statusCode}).`,
      { statusCode: raw.statusCode, rawBody: raw.body.slice(0, 2000), cause },
    );
  }
  if (!isRecord(decoded)) {
    throw new UnexpectedResponseError(
      `The Wthaiq API returned JSON that is not an object (HTTP ${raw.statusCode}).`,
      { statusCode: raw.statusCode, rawBody: raw.body.slice(0, 2000) },
    );
  }
  return decoded as T;
}

/** Validates the per-request options. @internal */
export function parseRequestOptions(options: RequestOptions | undefined): RequestOptions {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new InvalidArgumentError('Request options must be an object such as { idempotencyKey: "…" }.');
  }
  for (const key of Object.keys(options)) {
    if (!REQUEST_OPTION_KEYS.has(key)) {
      throw new InvalidArgumentError(
        `Unknown request option "${key}". Allowed: ${[...REQUEST_OPTION_KEYS].join(', ')}.`,
      );
    }
  }
  const { idempotencyKey, timeout, maxRetries, headers, apiKey, signal } = options;
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '')) {
    throw new InvalidArgumentError('idempotencyKey must be a non-empty string.');
  }
  if (idempotencyKey !== undefined && idempotencyKey.length > 200) {
    throw new InvalidArgumentError('idempotencyKey must be at most 200 characters.');
  }
  if (timeout !== undefined && !(typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0)) {
    throw new InvalidArgumentError('timeout must be a positive number of milliseconds.');
  }
  if (maxRetries !== undefined && !(Number.isInteger(maxRetries) && maxRetries >= 0)) {
    throw new InvalidArgumentError('maxRetries must be a non-negative integer.');
  }
  if (apiKey !== undefined) validateApiKey(apiKey);
  if (headers !== undefined) {
    if (!isRecord(headers)) throw new InvalidArgumentError('headers must be an object of strings.');
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'authorization') {
        throw new InvalidArgumentError('Use the apiKey option instead of an Authorization header.');
      }
      if (typeof value !== 'string') throw new InvalidArgumentError(`The header "${name}" must be a string.`);
    }
  }
  if (signal !== undefined && (typeof signal !== 'object' || typeof signal.addEventListener !== 'function')) {
    throw new InvalidArgumentError('signal must be an AbortSignal.');
  }
  return options;
}

/** Validates an API key and returns it trimmed. @internal */
export function validateApiKey(key: unknown): string {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new InvalidArgumentError(
      "An API key is required. Create one at https://developers.wthaiq.com and pass it as new Wthaiq('sk_...').",
    );
  }
  const trimmed = key.trim();
  if (!/^(sk|pk)_[A-Za-z0-9_]+$/.test(trimmed)) {
    throw new InvalidArgumentError(
      'The API key must start with sk_ (secret), sk_test_ (test), pk_ or pk_test_ (publishable).',
    );
  }
  return trimmed;
}

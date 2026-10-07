import { Wthaiq, type ClientOptions, type FetchLike, type FetchRequestInit } from '../src/index.js';

export const TEST_KEY = 'sk_test_' + 'a'.repeat(40);
export const LIVE_KEY = 'sk_' + 'b'.repeat(40);
export const BASE = 'https://api.test/api/v1';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | undefined;
  signal: AbortSignal;
}

type Responder = Response | Error | ((request: RecordedRequest) => Response | Promise<Response>);

/** A scripted fetch: responses are returned in order; every request is recorded. */
export class MockFetch {
  readonly requests: RecordedRequest[] = [];
  private readonly queue: Responder[] = [];

  push(...responses: Responder[]): this {
    this.queue.push(...responses);
    return this;
  }

  get last(): RecordedRequest {
    const request = this.requests[this.requests.length - 1];
    if (request === undefined) throw new Error('No request was sent');
    return request;
  }

  get remaining(): number {
    return this.queue.length;
  }

  readonly fetch: FetchLike = async (url: string, init: FetchRequestInit) => {
    const request: RecordedRequest = {
      url,
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
      signal: init.signal,
    };
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) throw new Error(`Unexpected request: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(request);
    return next;
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'wthaiq-request-id': 'req_0123456789abcdef01',
      'wthaiq-version': '2026-07-01',
      ...headers,
    },
  });
}

export function apiError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const types: Record<number, string> = {
    400: 'invalid_request_error',
    401: 'authentication_error',
    402: 'quota_error',
    403: 'permission_error',
    404: 'invalid_request_error',
    409: 'invalid_request_error',
    429: 'rate_limit_error',
  };
  return json(
    status,
    {
      error: {
        type: types[status] ?? 'api_error',
        code,
        message: `رسالة ${code}`,
        request_id: 'req_ffffffffffffffffff',
        ...extra,
      },
    },
    headers,
  );
}

export interface TestClient {
  wt: Wthaiq;
  mock: MockFetch;
  sleeps: number[];
}

export function makeClient(options: ClientOptions = {}, apiKey = TEST_KEY): TestClient {
  const mock = new MockFetch();
  const sleeps: number[] = [];
  const wt = new Wthaiq(apiKey, {
    baseUrl: BASE,
    fetch: mock.fetch,
    retryPolicy: {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    },
    ...options,
  });
  return { wt, mock, sleeps };
}

export function bodyJson(request: RecordedRequest): unknown {
  if (typeof request.body !== 'string') throw new Error('The request body is not a string');
  return JSON.parse(request.body);
}

export function query(request: RecordedRequest): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export function path(request: RecordedRequest): string {
  return new URL(request.url).pathname.replace(/^\/api\/v1/, '');
}

export const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n',
);

export function signatureRequest(id = 'sr_cd5a6eb8468344583538', status = 'draft'): Record<string, unknown> {
  return {
    id,
    object: 'signature_request',
    livemode: false,
    status,
    title: 'Probe',
    legal_level: 'ses',
    format: 'pades-lt',
    source: { type: 'template', template_id: 'tpl_998488' },
    signers: [
      {
        id: 'sgr_71769e6564cbb1d00ccc',
        object: 'signer',
        name: 'Noha',
        email: 'noha@example.com',
        phone: null,
        type: 'individual',
        method: 'draw',
        require_identity: false,
        order: 1,
        status: 'pending',
        signing_url: null,
        viewed_at: null,
        signed_at: null,
        fields: {},
      },
    ],
    ordered: false,
    require_identity: false,
    reference: null,
    cc: [],
    reminders: { enabled: false },
    metadata: {},
    expires_at: 1791958089,
    completed_at: null,
    download_url: null,
    created_at: 1791353289,
  };
}

export function list(
  data: unknown[],
  hasMore = false,
  nextCursor: string | null = null,
): Record<string, unknown> {
  return { object: 'list', data, has_more: hasMore, next_cursor: nextCursor };
}

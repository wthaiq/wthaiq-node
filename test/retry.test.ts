import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiConnectionError, ConflictError, RateLimitError, RetryPolicy, ServerError } from '../src/index.js';
import { apiError, json, makeClient, signatureRequest } from './helpers.js';

const ok = (): Response => json(200, { object: 'api_root' });

describe('automatic retries', () => {
  it('retries transient server errors and succeeds', async () => {
    const { wt, mock, sleeps } = makeClient();
    mock.push(apiError(500, 'internal_error'), apiError(503, 'maintenance'), ok());
    const account = await wt.account.retrieve();
    assert.equal(account.object, 'api_root');
    assert.equal(mock.requests.length, 3);
    assert.deepEqual(sleeps, [375, 750], 'backoff 500·2^n with jitter (random 0.5)');
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const { wt, mock } = makeClient({ maxRetries: 2 });
    mock.push(
      apiError(502, 'bad_gateway'),
      apiError(504, 'gateway_timeout'),
      apiError(500, 'internal_error'),
    );
    await assert.rejects(
      () => wt.account.retrieve(),
      (error: unknown) => error instanceof ServerError && error.code === 'internal_error',
    );
    assert.equal(mock.requests.length, 3);
  });

  it('honours a per-request maxRetries', async () => {
    const { wt, mock } = makeClient();
    mock.push(apiError(500, 'internal_error'));
    await assert.rejects(() => wt.account.retrieve({ maxRetries: 0 }), ServerError);
    assert.equal(mock.requests.length, 1);
  });

  it('reuses the same idempotency key on every retry of a POST', async () => {
    const { wt, mock } = makeClient();
    mock.push(
      apiError(409, 'idempotency_in_progress', {}, { 'retry-after': '5' }),
      new TypeError('socket hang up'),
      json(201, signatureRequest()),
    );
    await wt.signatureRequests.create({ source: { type: 'template', template_id: 'tpl_1' }, signers: [] });
    const keys = mock.requests.map((request) => request.headers['Idempotency-Key']);
    assert.equal(keys.length, 3);
    assert.equal(new Set(keys).size, 1);
    assert.equal(mock.requests[0]?.body, mock.requests[2]?.body);
  });

  it('honours Retry-After and caps it at 60 seconds', async () => {
    const { wt, mock, sleeps } = makeClient();
    mock.push(
      apiError(429, 'too_many_requests', {}, { 'retry-after': '3' }),
      apiError(429, 'too_many_requests', {}, { 'retry-after': '3600' }),
      ok(),
    );
    await wt.account.retrieve();
    assert.deepEqual(sleeps, [3000, 60000]);
  });

  it('does not retry quota-style 429s', async () => {
    for (const code of [
      'daily_cap_reached',
      'reminder_limit_reached',
      'reminder_too_soon',
      'test_daily_limit',
      'test_email_limit',
    ]) {
      const { wt, mock } = makeClient();
      mock.push(apiError(429, code, {}, { 'retry-after': '1' }));
      await assert.rejects(() => wt.account.retrieve(), RateLimitError);
      assert.equal(mock.requests.length, 1, code);
    }
  });

  it('does not retry delivery_failed, feature_unavailable, 501 or client errors', async () => {
    const cases: [number, string][] = [
      [502, 'delivery_failed'],
      [503, 'feature_unavailable'],
      [501, 'not_implemented'],
      [400, 'invalid_request'],
      [401, 'invalid_api_key'],
      [402, 'insufficient_balance'],
      [403, 'forbidden'],
      [404, 'resource_missing'],
      [409, 'idempotency_key_reused'],
      [409, 'pdf_not_ready'],
    ];
    for (const [status, code] of cases) {
      const { wt, mock } = makeClient();
      mock.push(apiError(status, code));
      await assert.rejects(() => wt.account.retrieve());
      assert.equal(mock.requests.length, 1, `${status} ${code}`);
    }
  });

  it('retries idempotency_in_progress conflicts', async () => {
    const { wt, mock } = makeClient({ maxRetries: 1 });
    mock.push(apiError(409, 'idempotency_in_progress'), apiError(409, 'idempotency_in_progress'));
    await assert.rejects(
      () => wt.signatureRequests.send('sr_1'),
      (error: unknown) => error instanceof ConflictError && error.code === 'idempotency_in_progress',
    );
    assert.equal(mock.requests.length, 2);
  });

  it('retries connection errors', async () => {
    const { wt, mock } = makeClient({ maxRetries: 1 });
    mock.push(new TypeError('fetch failed'), ok());
    assert.equal((await wt.account.retrieve()).object, 'api_root');
    const { wt: wt0, mock: mock0 } = makeClient({ maxRetries: 0 });
    mock0.push(new TypeError('fetch failed'));
    await assert.rejects(() => wt0.account.retrieve(), ApiConnectionError);
    assert.equal(mock.requests.length, 2);
  });
});

describe('RetryPolicy', () => {
  it('computes exponential backoff with jitter, capped at maxDelay', () => {
    const low = new RetryPolicy({ random: () => 0 });
    const high = new RetryPolicy({ random: () => 0.999999 });
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((n) => low.delay(n, null)),
      [250, 500, 1000, 2000, 4000, 4000],
    );
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map((n) => Math.round(high.delay(n, null))),
      [500, 1000, 2000, 4000, 8000, 8000],
    );
  });

  it('prefers a numeric Retry-After header', () => {
    const policy = new RetryPolicy({ maxRetryAfter: 10_000 });
    assert.equal(policy.delay(0, '2'), 2000);
    assert.equal(policy.delay(0, ' 1.5 '), 1500);
    assert.equal(policy.delay(0, '0'), 0);
    assert.equal(policy.delay(0, '999'), 10_000);
    const fallback = new RetryPolicy({ random: () => 0 });
    assert.equal(fallback.delay(0, 'Wed, 21 Oct 2026 07:28:00 GMT'), 250, 'HTTP dates fall back to backoff');
  });

  it('classifies retryable outcomes', () => {
    const policy = new RetryPolicy();
    assert.equal(policy.shouldRetry(null, null), true);
    assert.equal(policy.shouldRetry(429, null), true);
    assert.equal(policy.shouldRetry(429, 'too_many_requests'), true);
    assert.equal(policy.shouldRetry(429, 'daily_cap_reached'), false);
    assert.equal(policy.shouldRetry(409, 'idempotency_in_progress'), true);
    assert.equal(policy.shouldRetry(409, 'idempotency_key_reused'), false);
    assert.equal(policy.shouldRetry(500, 'internal_error'), true);
    assert.equal(policy.shouldRetry(502, null), true);
    assert.equal(policy.shouldRetry(502, 'delivery_failed'), false);
    assert.equal(policy.shouldRetry(503, 'feature_unavailable'), false);
    assert.equal(policy.shouldRetry(504, null), true);
    assert.equal(policy.shouldRetry(501, 'not_implemented'), false);
    assert.equal(policy.shouldRetry(400, null), false);
  });

  it('uses the injected sleep', async () => {
    const slept: number[] = [];
    const policy = new RetryPolicy({ sleep: async (ms) => void slept.push(ms) });
    await policy.sleep(42);
    assert.deepEqual(slept, [42]);
    const real = new RetryPolicy();
    const start = Date.now();
    await real.sleep(5);
    assert.ok(Date.now() - start >= 0);
  });
});

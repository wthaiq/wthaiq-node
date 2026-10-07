import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Wthaiq, {
  API_VERSION,
  DEFAULT_BASE_URL,
  InvalidArgumentError,
  RetryPolicy,
  VERSION,
  Webhook,
  Wthaiq as NamedWthaiq,
  errors,
} from '../src/index.js';
import { BASE, json, LIVE_KEY, makeClient, MockFetch, TEST_KEY } from './helpers.js';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string };

describe('client construction', () => {
  it('exports the class as default and named export, with static helpers', () => {
    assert.equal(Wthaiq, NamedWthaiq);
    assert.equal(Wthaiq.VERSION, VERSION);
    assert.equal(Wthaiq.API_VERSION, '2026-07-01');
    assert.equal(API_VERSION, '2026-07-01');
    assert.equal(Wthaiq.DEFAULT_BASE_URL, 'https://wthaiq.com/api/v1');
    assert.equal(Wthaiq.Webhook, Webhook);
    assert.equal(Wthaiq.errors, errors);
    assert.equal(errors.RateLimitError.name, 'RateLimitError');
  });

  it('keeps VERSION in sync with package.json', () => {
    assert.equal(VERSION, pkg.version);
  });

  it('accepts a key and options, or a single config object', () => {
    const a = new Wthaiq(TEST_KEY);
    assert.equal(a.getBaseUrl(), DEFAULT_BASE_URL);
    const b = new Wthaiq({ apiKey: TEST_KEY, baseUrl: 'http://127.0.0.1:8782/api/v1/' });
    assert.equal(b.getBaseUrl(), 'http://127.0.0.1:8782/api/v1');
  });

  it('exposes every resource', () => {
    const wt = new Wthaiq(TEST_KEY);
    for (const name of [
      'account',
      'usage',
      'balance',
      'templates',
      'signatureRequests',
      'sessions',
      'signers',
      'documents',
      'identityVerifications',
      'verifications',
      'webhookEndpoints',
      'events',
      'flows',
      'webhooks',
    ] as const) {
      assert.equal(typeof wt[name], 'object', name);
    }
  });

  it('derives the mode from the key prefix', () => {
    const test = new Wthaiq(TEST_KEY);
    assert.equal(test.isTestMode(), true);
    assert.equal(test.isLiveMode(), false);
    assert.equal(test.isPublishableKey(), false);
    const live = new Wthaiq(LIVE_KEY);
    assert.equal(live.isLiveMode(), true);
    const pk = new Wthaiq('pk_test_' + 'c'.repeat(40));
    assert.equal(pk.isTestMode(), true);
    assert.equal(pk.isPublishableKey(), true);
  });

  it('trims the key', () => {
    const { wt, mock } = makeClient({}, `  ${TEST_KEY}\n`);
    mock.push(json(200, { object: 'api_root' }));
    return wt.account.retrieve().then(() => {
      assert.equal(mock.last.headers['Authorization'], `Bearer ${TEST_KEY}`);
    });
  });

  it('rejects invalid configuration before any request', () => {
    const bad: [unknown, unknown, RegExp][] = [
      [undefined, undefined, /API key is required/],
      ['', undefined, /API key is required/],
      ['secret', undefined, /must start with sk_/],
      ['sk_live key', undefined, /must start with sk_/],
      [TEST_KEY, { baseUrl: 'ftp://x' }, /baseUrl/],
      [TEST_KEY, { baseUrl: 'wthaiq.com' }, /baseUrl/],
      [TEST_KEY, { timeout: 0 }, /timeout/],
      [TEST_KEY, { timeout: '5' }, /timeout/],
      [TEST_KEY, { maxRetries: -1 }, /maxRetries/],
      [TEST_KEY, { maxRetries: 1.5 }, /maxRetries/],
      [TEST_KEY, { apiVersion: '' }, /apiVersion/],
      [TEST_KEY, { fetch: 'nope' }, /fetch/],
      [TEST_KEY, { retryPolicy: 3 }, /retryPolicy/],
      [TEST_KEY, { appInfo: { version: '1' } }, /appInfo/],
      [TEST_KEY, { base_url: BASE }, /Unknown client option\(s\): base_url/],
    ];
    for (const [key, options, message] of bad) {
      assert.throws(
        () => new Wthaiq(key as string, options as never),
        (error: unknown) => error instanceof InvalidArgumentError && message.test(error.message),
        String(message),
      );
    }
  });

  it('accepts a RetryPolicy instance', () => {
    const wt = new Wthaiq(TEST_KEY, { retryPolicy: new RetryPolicy({ initialDelay: 1 }) });
    assert.equal(wt.isTestMode(), true);
  });
});

describe('default headers', () => {
  it('sends authentication, version, user agent and accept headers', async () => {
    const { wt, mock } = makeClient({
      appInfo: { name: 'My App', version: '2.1', url: 'https://example.com' },
    });
    mock.push(json(200, { object: 'api_root' }));
    await wt.account.retrieve();
    const headers = mock.last.headers;
    assert.equal(headers['Authorization'], `Bearer ${TEST_KEY}`);
    assert.equal(headers['Wthaiq-Version'], '2026-07-01');
    assert.equal(headers['Accept'], 'application/json');
    assert.match(
      headers['User-Agent'] ?? '',
      new RegExp(
        `^wthaiq-node/${VERSION.replace(/\./g, '\\.')} node/\\d+\\.\\d+\\.\\d+ My-App/2\\.1 \\(https://example\\.com\\)$`,
      ),
    );
    assert.equal(headers['Idempotency-Key'], undefined, 'GET requests carry no idempotency key');
    assert.equal(mock.last.method, 'GET');
    assert.equal(mock.last.url, `${BASE}/`);
  });

  it('sends a custom API version', async () => {
    const { wt, mock } = makeClient({ apiVersion: '2027-01-01' });
    mock.push(json(200, { object: 'api_root' }));
    await wt.account.retrieve();
    assert.equal(mock.last.headers['Wthaiq-Version'], '2027-01-01');
  });

  it('uses the global fetch when none is given', async () => {
    const original = globalThis.fetch;
    const mock = new MockFetch().push(json(200, { object: 'usage' }));
    globalThis.fetch = mock.fetch as unknown as typeof fetch;
    try {
      const wt = new Wthaiq(TEST_KEY, { baseUrl: BASE });
      const usage = await wt.usage.retrieve();
      assert.equal(usage.object, 'usage');
      assert.equal(mock.last.url, `${BASE}/usage`);
    } finally {
      globalThis.fetch = original;
    }
  });
});

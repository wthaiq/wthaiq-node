import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ApiConnectionError,
  InvalidArgumentError,
  ResponseMeta,
  UnexpectedResponseError,
} from '../src/index.js';
import { bodyJson, json, makeClient, query, signatureRequest } from './helpers.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('request encoding', () => {
  it('encodes GET parameters, skipping null/undefined and writing booleans and dates', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'list', data: [], has_more: false, next_cursor: null }));
    await wt.signatureRequests.list({
      status: 'completed',
      limit: 5,
      created_after: new Date(1791353289000),
      created_before: undefined as unknown as string,
      starting_after: null as unknown as string,
    });
    assert.deepEqual(query(mock.last), { status: 'completed', limit: '5', created_after: '1791353289' });
    const { wt: wt2, mock: mock2 } = makeClient();
    mock2.push(json(200, { object: 'list', data: [], has_more: false, next_cursor: null }));
    await wt2.templates.list({ scope: 'mine', search: 'عقد عمل' });
    assert.equal(query(mock2.last)['search'], 'عقد عمل');
    assert.match(mock2.last.url, /search=%D8%B9/);
  });

  it('sends POST bodies as JSON with an automatic UUID v4 idempotency key', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(201, signatureRequest()));
    const params = {
      source: { type: 'template' as const, template_id: 'tpl_1' },
      signers: [{ name: 'نهى', email: 'noha@example.com' }],
      metadata: { path: '/a/b' },
    };
    await wt.signatureRequests.create(params);
    assert.equal(mock.last.method, 'POST');
    assert.equal(mock.last.headers['Content-Type'], 'application/json');
    assert.match(mock.last.headers['Idempotency-Key'] ?? '', UUID_V4);
    assert.deepEqual(bodyJson(mock.last), params);
    assert.equal(mock.last.body, JSON.stringify(params), 'unicode and slashes are not escaped');
  });

  it('sends {} for POST requests without parameters', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, signatureRequest('sr_1', 'canceled')));
    await wt.signatureRequests.cancel('sr_1');
    assert.equal(mock.last.body, '{}');
  });

  it('generates a new idempotency key per call', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, signatureRequest()), json(200, signatureRequest()));
    await wt.signatureRequests.send('sr_1');
    await wt.signatureRequests.send('sr_1');
    assert.notEqual(
      mock.requests[0]?.headers['Idempotency-Key'],
      mock.requests[1]?.headers['Idempotency-Key'],
    );
  });

  it('uses the caller idempotency key, API key, headers and timeout', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(201, signatureRequest()));
    const otherKey = 'sk_test_' + 'd'.repeat(40);
    await wt.signatureRequests.create(
      { source: { type: 'template', template_id: 'tpl_1' }, signers: [] },
      {
        idempotencyKey: 'order-1024',
        apiKey: otherKey,
        headers: { 'X-Trace': 't-1', accept: 'text/plain' },
        timeout: 5000,
      },
    );
    assert.equal(mock.last.headers['Idempotency-Key'], 'order-1024');
    assert.equal(mock.last.headers['Authorization'], `Bearer ${otherKey}`);
    assert.equal(mock.last.headers['X-Trace'], 't-1');
    assert.equal(mock.last.headers['accept'], 'text/plain');
    assert.equal(
      mock.last.headers['Accept'],
      undefined,
      'a custom header replaces the default case-insensitively',
    );
  });

  it('URL-encodes ids and refuses empty ids', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'verification', found: true }));
    await wt.verifications.retrieve('WTQ-1A/2B 3C');
    assert.ok(mock.last.url.endsWith('/verifications/WTQ-1A%2F2B%203C'));
    await assert.rejects(() => wt.signatureRequests.retrieve(''), InvalidArgumentError);
    await assert.rejects(() => wt.signatureRequests.retrieve('   '), InvalidArgumentError);
    await assert.rejects(
      () => wt.signatureRequests.retrieve(undefined as unknown as string),
      InvalidArgumentError,
    );
    await assert.rejects(async () => wt.signatureRequests.listEvents(''), InvalidArgumentError);
    await assert.rejects(async () => wt.signatureRequests.list('x' as never), /plain object/);
    assert.equal(mock.requests.length, 1);
  });

  it('validates request options', async () => {
    const { wt, mock } = makeClient();
    const bad: [unknown, RegExp][] = [
      [{ idempotency_key: 'x' }, /Unknown request option "idempotency_key"/],
      [{ idempotencyKey: '' }, /idempotencyKey/],
      [{ idempotencyKey: 'x'.repeat(201) }, /200 characters/],
      [{ timeout: -1 }, /timeout/],
      [{ maxRetries: 'two' }, /maxRetries/],
      [{ apiKey: 'nope' }, /must start with sk_/],
      [{ headers: { Authorization: 'Bearer x' } }, /apiKey option/],
      [{ headers: { 'X-Num': 1 } }, /must be a string/],
      [{ signal: {} }, /AbortSignal/],
      ['opts', /must be an object/],
    ];
    for (const [options, message] of bad) {
      await assert.rejects(
        () => wt.account.retrieve(options as never),
        (error: unknown) => {
          return error instanceof InvalidArgumentError && message.test(error.message);
        },
      );
    }
    await assert.rejects(() => wt.signatureRequests.create('x' as never), /plain object/);
    assert.equal(mock.requests.length, 0);
  });
});

describe('responses', () => {
  it('returns plain objects with non-enumerable HTTP metadata', async () => {
    const { wt, mock } = makeClient();
    mock.push(
      json(201, signatureRequest(), {
        'idempotent-replayed': 'true',
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '1791353300',
      }),
    );
    const sr = await wt.signatureRequests.create({
      source: { type: 'template', template_id: 'tpl_1' },
      signers: [],
    });
    assert.equal(sr.id, 'sr_cd5a6eb8468344583538');
    assert.equal(sr.signers[0]?.name, 'Noha');
    assert.ok(sr.lastResponse instanceof ResponseMeta);
    assert.equal(sr.lastResponse.statusCode, 201);
    assert.equal(sr.lastResponse.requestId, 'req_0123456789abcdef01');
    assert.equal(sr.lastResponse.apiVersion, '2026-07-01');
    assert.equal(sr.lastResponse.idempotentReplayed, true);
    assert.deepEqual(sr.lastResponse.rateLimit, { limit: 100, remaining: 99, reset: 1791353300 });
    assert.equal(sr.lastResponse.getHeader('Content-Type'), 'application/json');
    assert.equal(Object.keys(sr).includes('lastResponse'), false);
    assert.equal(JSON.stringify(sr), JSON.stringify(signatureRequest()));
    assert.equal({ ...sr }.lastResponse, undefined);
  });

  it('reports a missing rate limit as null and replays as false', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'api_root' }));
    const account = await wt.account.retrieve();
    assert.equal(account.lastResponse.rateLimit, null);
    assert.equal(account.lastResponse.idempotentReplayed, false);
  });

  it('keeps unknown fields', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { ...signatureRequest(), brand_new_field: { nested: [1, 2] } }));
    const sr = await wt.signatureRequests.retrieve('sr_1');
    assert.deepEqual((sr as unknown as Record<string, unknown>)['brand_new_field'], { nested: [1, 2] });
  });

  it('throws UnexpectedResponseError for a success body that is not a JSON object', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, '<html>maintenance</html>'), json(200, '[1,2]'), json(200, ''));
    await assert.rejects(
      () => wt.account.retrieve(),
      (error: unknown) => {
        return (
          error instanceof UnexpectedResponseError &&
          error.statusCode === 200 &&
          error.rawBody.includes('maintenance')
        );
      },
    );
    await assert.rejects(() => wt.account.retrieve(), /not an object/);
    await assert.rejects(() => wt.account.retrieve(), /not valid JSON/);
  });
});

describe('connection failures', () => {
  it('wraps network errors in ApiConnectionError (after retries)', async () => {
    const { wt, mock, sleeps } = makeClient();
    const cause = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.test') });
    mock.push(cause, cause, cause);
    await assert.rejects(
      () => wt.account.retrieve(),
      (error: unknown) => {
        assert.ok(error instanceof ApiConnectionError);
        assert.equal(error.cause, cause);
        assert.equal(error.timedOut, false);
        assert.match(error.message, /ENOTFOUND/);
        return true;
      },
    );
    assert.equal(mock.requests.length, 3);
    assert.equal(sleeps.length, 2);
  });

  it('aborts an attempt that exceeds the timeout', async () => {
    const { wt, mock } = makeClient({ maxRetries: 0, timeout: 20 });
    mock.push(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    await assert.rejects(
      () => wt.account.retrieve(),
      (error: unknown) => {
        return (
          error instanceof ApiConnectionError &&
          error.timedOut &&
          error.message.includes('timed out after 20 ms')
        );
      },
    );
  });

  it('retries a timed-out attempt', async () => {
    const { wt, mock } = makeClient({ maxRetries: 1, timeout: 20 });
    mock.push(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      json(200, { object: 'api_root' }),
    );
    const account = await wt.account.retrieve();
    assert.equal(account.object, 'api_root');
    assert.equal(mock.requests.length, 2);
  });

  it('stops at once, without retrying, when the caller aborts', async () => {
    const { wt, mock } = makeClient();
    const controller = new AbortController();
    mock.push((request) => {
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        controller.abort();
      });
    });
    await assert.rejects(
      () => wt.account.retrieve({ signal: controller.signal }),
      (error: unknown) => {
        return error instanceof ApiConnectionError && error.aborted && !error.timedOut;
      },
    );
    assert.equal(mock.requests.length, 1);
    await assert.rejects(() => wt.account.retrieve({ signal: controller.signal }), /aborted by the caller/);
    assert.equal(mock.requests.length, 1, 'an already-aborted signal sends nothing');
  });
});

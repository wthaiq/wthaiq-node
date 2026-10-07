import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ApiError,
  AuthenticationError,
  ConflictError,
  InvalidRequestError,
  NotFoundError,
  PaymentRequiredError,
  PermissionError,
  PLANS_URL,
  RateLimitError,
  ServerError,
  ValidationError,
  VERIFY_URL,
  WthaiqError,
} from '../src/index.js';
import { apiError, json, makeClient } from './helpers.js';

async function failWith(response: Response): Promise<ApiError> {
  const { wt, mock } = makeClient({ maxRetries: 0 });
  mock.push(response);
  try {
    await wt.account.retrieve();
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error;
  }
  throw new Error('expected an error');
}

describe('error mapping', () => {
  const cases: [number, string, new (...args: never[]) => ApiError, string][] = [
    [400, 'parameter_missing', ValidationError, 'ValidationError'],
    [401, 'invalid_api_key', AuthenticationError, 'AuthenticationError'],
    [402, 'plan_required', PaymentRequiredError, 'PaymentRequiredError'],
    [403, 'forbidden', PermissionError, 'PermissionError'],
    [404, 'resource_missing', NotFoundError, 'NotFoundError'],
    [405, 'method_not_allowed', InvalidRequestError, 'InvalidRequestError'],
    [409, 'request_not_cancelable', ConflictError, 'ConflictError'],
    [429, 'reminder_too_soon', RateLimitError, 'RateLimitError'],
    [500, 'internal_error', ServerError, 'ServerError'],
    [501, 'not_implemented', ServerError, 'ServerError'],
    [502, 'delivery_failed', ServerError, 'ServerError'],
    [503, 'feature_unavailable', ServerError, 'ServerError'],
  ];
  for (const [status, code, ErrorClass, name] of cases) {
    it(`maps HTTP ${status} ${code} to ${name}`, async () => {
      const error = await failWith(apiError(status, code, { param: 'signers[0].email' }));
      assert.ok(error instanceof ErrorClass);
      assert.ok(error instanceof ApiError);
      assert.ok(error instanceof WthaiqError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, name);
      assert.equal(error.statusCode, status);
      assert.equal(error.code, code);
      assert.equal(error.param, 'signers[0].email');
      assert.equal(error.message, `رسالة ${code}`);
      assert.equal(error.requestId, 'req_ffffffffffffffffff');
      assert.equal(error.getHeader('Wthaiq-Request-Id'), 'req_0123456789abcdef01');
      assert.equal(typeof error.rawBody, 'string');
      assert.equal(error.error['code'], code);
    });
  }

  it('groups 400, 404 and 409 under InvalidRequestError', async () => {
    for (const status of [400, 404, 409]) {
      assert.ok((await failWith(apiError(status, 'x'))) instanceof InvalidRequestError);
    }
  });

  it('exposes field errors on ValidationError', async () => {
    const error = (await failWith(
      apiError(400, 'invalid_request', { param: 'source.template_id' }),
    )) as ValidationError;
    assert.deepEqual(error.fieldErrors, { 'source.template_id': 'رسالة invalid_request' });
    const withoutParam = (await failWith(apiError(400, 'invalid_json'))) as ValidationError;
    assert.deepEqual(withoutParam.fieldErrors, {});
    assert.equal(withoutParam.param, null);
    assert.equal(withoutParam.type, 'invalid_request_error');
  });

  it('exposes plan details on PermissionError', async () => {
    const feature = (await failWith(
      apiError(403, 'plan_feature_unavailable', {
        feature: 'bulk',
        required_plan: 'ap_ent',
        upgrade_url: 'https://developers.wthaiq.com/plans?f=bulk',
      }),
    )) as PermissionError;
    assert.equal(feature.isPlanFeatureUnavailable(), true);
    assert.equal(feature.isKybRequired(), false);
    assert.equal(feature.feature, 'bulk');
    assert.equal(feature.requiredPlan, 'ap_ent');
    assert.equal(feature.upgradeUrl, 'https://developers.wthaiq.com/plans?f=bulk');

    const noUrl = (await failWith(
      apiError(403, 'plan_feature_unavailable', { required_plan: null }),
    )) as PermissionError;
    assert.equal(noUrl.requiredPlan, null);
    assert.equal(noUrl.upgradeUrl, PLANS_URL);

    const kyb = (await failWith(apiError(403, 'kyb_required'))) as PermissionError;
    assert.equal(kyb.isKybRequired(), true);
    assert.equal(kyb.upgradeUrl, VERIFY_URL);

    const forbidden = (await failWith(apiError(403, 'forbidden'))) as PermissionError;
    assert.equal(forbidden.upgradeUrl, null);
    assert.equal(forbidden.feature, null);
  });

  it('exposes helpers on PaymentRequiredError', async () => {
    const required = (await failWith(apiError(402, 'plan_required'))) as PaymentRequiredError;
    assert.equal(required.isPlanRequired(), true);
    assert.equal(required.upgradeUrl, PLANS_URL);
    const expired = (await failWith(apiError(402, 'plan_expired'))) as PaymentRequiredError;
    assert.equal(expired.isPlanExpired(), true);
    const balance = (await failWith(
      apiError(402, 'insufficient_balance', { upgrade_url: 'https://x.test/topup' }),
    )) as PaymentRequiredError;
    assert.equal(balance.isInsufficientBalance(), true);
    assert.equal(balance.upgradeUrl, 'https://x.test/topup');
  });

  it('exposes Retry-After on RateLimitError', async () => {
    const transient = (await failWith(
      apiError(429, 'too_many_requests', {}, { 'retry-after': '7' }),
    )) as RateLimitError;
    assert.equal(transient.retryAfter, 7);
    assert.equal(transient.isTransient(), true);
    const quota = (await failWith(apiError(429, 'test_daily_limit'))) as RateLimitError;
    assert.equal(quota.retryAfter, null);
    assert.equal(quota.isTransient(), false);
  });

  it('builds a message for bodies without an error envelope', async () => {
    const html = await failWith(
      new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
        status: 502,
        headers: { 'wthaiq-request-id': 'req_x' },
      }),
    );
    assert.ok(html instanceof ServerError);
    assert.equal(html.message, 'The Wthaiq API returned HTTP 502: 502 Bad Gateway');
    assert.equal(html.code, null);
    assert.equal(html.requestId, 'req_x', 'falls back to the request id header');

    const empty = await failWith(new Response(null, { status: 500 }));
    assert.equal(empty.message, 'The Wthaiq API returned HTTP 500.');
    assert.equal(empty.requestId, null);

    const notJson = await failWith(json(400, '{"error": "plain string"}'));
    assert.ok(notJson instanceof ValidationError);
    assert.deepEqual(notJson.error, {});
  });

  it('treats an unexpected redirect as an error', async () => {
    const error = await failWith(
      new Response(null, { status: 301, headers: { location: 'https://elsewhere' } }),
    );
    assert.equal(error.name, 'ApiError');
    assert.equal(error.statusCode, 301);
  });
});

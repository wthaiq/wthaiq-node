import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import Wthaiq, { InvalidArgumentError, SignatureVerificationError, Webhook } from '../src/index.js';
import { TEST_KEY } from './helpers.js';

interface Fixture {
  secret: string;
  headers: Record<string, string>;
  payload: string;
  event_id: string;
}

/** A delivery captured from the platform's own delivery code (see the PHP SDK's capture tool). */
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test', 'fixtures', 'webhook-server-signed.json'), 'utf8'),
) as Fixture;
const header = fixture.headers['Wthaiq-Signature'] ?? '';
const signedAt = Number(/t=(\d+)/.exec(header)?.[1]);

function isSignatureError(pattern: RegExp) {
  return (error: unknown): boolean =>
    error instanceof SignatureVerificationError && pattern.test(error.message);
}

describe('webhook verification against the server-signed fixture', () => {
  it('verifies the payload exactly as the platform signed it (string body)', () => {
    const event = Webhook.constructEvent(fixture.payload, header, fixture.secret, 0);
    assert.equal(event.id, fixture.event_id);
    assert.equal(event.object, 'event');
    assert.equal(event.type, 'signature_request.completed');
    assert.equal(event.livemode, false);
    if (event.type === 'signature_request.completed') {
      assert.equal(event.data.object.id, 'sr_cd5a6eb8468344583538');
      assert.equal(event.data.object.title, 'عقد خدمات — SDK fixture');
      assert.deepEqual(event.data.object.metadata, { order_id: 'A/1024', note: 'slashes / and "quotes"' });
    }
  });

  it('verifies the raw bytes (Buffer body, as with express.raw)', () => {
    const event = Webhook.constructEvent(Buffer.from(fixture.payload, 'utf8'), header, fixture.secret, 0);
    assert.equal(event.id, fixture.event_id);
    assert.equal(Webhook.isValid(new TextEncoder().encode(fixture.payload), header, fixture.secret, 0), true);
  });

  it('matches node:crypto HMAC-SHA256 for the fixture', () => {
    const expected = createHmac('sha256', fixture.secret)
      .update(`${signedAt}.${fixture.payload}`)
      .digest('hex');
    assert.equal(Webhook.computeSignature(signedAt, fixture.payload, fixture.secret), expected);
    assert.ok(header.endsWith(`v1=${expected}`));
  });

  it('enforces the timestamp tolerance', () => {
    const ageSeconds = Math.floor(Date.now() / 1000) - signedAt;
    assert.ok(ageSeconds > 300, 'the fixture is older than the default tolerance');
    assert.throws(
      () => Webhook.constructEvent(fixture.payload, header, fixture.secret),
      isSignatureError(/outside the tolerance of 300 seconds/),
    );
    assert.doesNotThrow(() =>
      Webhook.constructEvent(fixture.payload, header, fixture.secret, ageSeconds + 60),
    );
  });

  it('rejects a tampered payload, a wrong secret and a re-encoded body', () => {
    const tampered = fixture.payload.replace('"livemode":false', '"livemode":true');
    assert.throws(
      () => Webhook.constructEvent(tampered, header, fixture.secret, 0),
      isSignatureError(/does not match/),
    );
    assert.throws(
      () => Webhook.constructEvent(fixture.payload, header, 'whsec_wrong', 0),
      isSignatureError(/does not match/),
    );
    const reEncoded = JSON.stringify(JSON.parse(fixture.payload), null, 1);
    assert.throws(
      () => Webhook.constructEvent(reEncoded, header, fixture.secret, 0),
      SignatureVerificationError,
    );
    const secretWithoutPrefix = fixture.secret.replace(/^whsec_/, '');
    assert.equal(
      Webhook.isValid(fixture.payload, header, secretWithoutPrefix, 0),
      false,
      'the whsec_ prefix is part of the key',
    );
  });
});

describe('webhook header handling', () => {
  const payload =
    '{"id":"evt_1","object":"event","type":"signer.signed","created_at":1,"livemode":false,"data":{"object":{"id":"sgr_1"}}}';
  const secret = 'whsec_' + '1'.repeat(48);

  it('round-trips generateTestHeader with the current time', () => {
    const generated = Webhook.generateTestHeader({ payload, secret });
    assert.match(generated, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(Webhook.constructEvent(payload, generated, secret).id, 'evt_1');
    assert.equal(Webhook.verifyHeader(payload, generated, secret), generated);
  });

  it('accepts rotated secrets (several v1 values), upper-case hex, spaces and array headers', () => {
    const t = Math.floor(Date.now() / 1000);
    const good = Webhook.computeSignature(t, payload, secret);
    const rotated = `t=${t},v1=${'0'.repeat(64)},v1=${good}`;
    assert.equal(Webhook.isValid(payload, rotated, secret), true);
    assert.equal(Webhook.isValid(payload, `t=${t}, v1=${good.toUpperCase()}`, secret), true);
    assert.equal(Webhook.isValid(payload, [`t=${t}`, `v1=${good}`], secret), true);
    assert.equal(Webhook.isValid(payload, `v1=${good},t=${t},v0=ignored,junk`, secret), true);
  });

  it('rejects missing or malformed headers', () => {
    const t = Math.floor(Date.now() / 1000);
    const good = Webhook.computeSignature(t, payload, secret);
    assert.throws(() => Webhook.constructEvent(payload, undefined, secret), isSignatureError(/missing/));
    assert.throws(() => Webhook.constructEvent(payload, '', secret), isSignatureError(/missing/));
    assert.throws(() => Webhook.constructEvent(payload, `v1=${good}`, secret), isSignatureError(/timestamp/));
    assert.throws(
      () => Webhook.constructEvent(payload, `t=abc,v1=${good}`, secret),
      isSignatureError(/timestamp/),
    );
    assert.throws(
      () => Webhook.constructEvent(payload, `t=${t}`, secret),
      isSignatureError(/No v1 signature/),
    );
    assert.throws(
      () => Webhook.constructEvent(payload, `t=${t},v1=${good.slice(0, 63)}`, secret),
      isSignatureError(/does not match/),
    );
    try {
      Webhook.constructEvent(payload, `t=${t},v1=bad`, secret);
    } catch (error) {
      assert.ok(error instanceof SignatureVerificationError);
      assert.equal(error.header, `t=${t},v1=bad`);
      assert.equal(error.name, 'SignatureVerificationError');
    }
  });

  it('rejects a future timestamp outside the tolerance', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const h = `t=${future},v1=${Webhook.computeSignature(future, payload, secret)}`;
    assert.throws(() => Webhook.constructEvent(payload, h, secret), isSignatureError(/tolerance/));
    assert.equal(Webhook.isValid(payload, h, secret, 7200), true);
  });

  it('refuses a parsed body, an empty secret and a bad tolerance as programming errors', () => {
    const h = Webhook.generateTestHeader({ payload, secret });
    assert.throws(
      () => Webhook.constructEvent(JSON.parse(payload) as never, h, secret),
      (error: unknown) => {
        return error instanceof InvalidArgumentError && error.message.includes('raw request body');
      },
    );
    assert.throws(() => Webhook.constructEvent(payload, h, ''), InvalidArgumentError);
    assert.throws(() => Webhook.constructEvent(payload, h, secret, -1), InvalidArgumentError);
    assert.throws(
      () => Webhook.isValid(payload, h, ''),
      InvalidArgumentError,
      'isValid only swallows signature errors',
    );
  });

  it('rejects a correctly signed body that is not a JSON object', () => {
    for (const body of ['not json', '[1,2]', '"text"']) {
      const h = Webhook.generateTestHeader({ payload: body, secret });
      assert.throws(() => Webhook.constructEvent(body, h, secret), SignatureVerificationError);
    }
  });

  it('is available on the client instance as wt.webhooks', () => {
    const wt = new Wthaiq(TEST_KEY);
    const h = wt.webhooks.generateTestHeader({ payload, secret, timestamp: 1700000000 });
    assert.equal(
      h,
      `t=1700000000,v1=${createHmac('sha256', secret).update(`1700000000.${payload}`).digest('hex')}`,
    );
    assert.equal(wt.webhooks.isValid(payload, h, secret, 0), true);
    assert.equal(wt.webhooks.verifyHeader(payload, h, secret, 0), h);
    assert.equal(wt.webhooks.constructEvent(payload, h, secret, 0).type, 'signer.signed');
    assert.equal(wt.webhooks.computeSignature('1700000000', payload, secret), h.split('v1=')[1]);
    assert.equal(Webhook.SIGNATURE_HEADER, 'Wthaiq-Signature');
    assert.equal(Webhook.EVENT_ID_HEADER, 'Wthaiq-Event-Id');
    assert.equal(Webhook.ENDPOINT_ID_HEADER, 'Wthaiq-Endpoint-Id');
    assert.equal(Webhook.DEFAULT_TOLERANCE, 300);
  });
});

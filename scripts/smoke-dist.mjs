import assert from 'node:assert/strict';
import Wthaiq, { Wthaiq as Named, Webhook, WthaiqError, VERSION } from 'wthaiq';

assert.equal(typeof Wthaiq, 'function');
assert.equal(Wthaiq, Named);
assert.equal(Wthaiq.Webhook, Webhook);
assert.equal(new Wthaiq('sk_test_0000').signatureRequests.constructor.name, 'SignatureRequests');
assert.ok(new Wthaiq.errors.AuthenticationError('x', { statusCode: 401 }) instanceof WthaiqError);
assert.match(VERSION, /^\d+\.\d+\.\d+/);
const header = Webhook.generateTestHeader({ payload: '{"id":"evt_1","object":"event"}', secret: 'whsec_x' });
assert.equal(Webhook.constructEvent('{"id":"evt_1","object":"event"}', header, 'whsec_x').id, 'evt_1');
console.log('ESM build OK');

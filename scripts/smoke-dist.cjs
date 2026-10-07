'use strict';
const assert = require('node:assert/strict');
const pkg = require('wthaiq');

const { Wthaiq, Webhook, WthaiqError, VERSION } = pkg;
assert.equal(typeof Wthaiq, 'function');
assert.equal(pkg.default, Wthaiq);
assert.equal(Wthaiq.Webhook, Webhook);
assert.ok(new Wthaiq.errors.AuthenticationError('x', { statusCode: 401 }) instanceof WthaiqError);
assert.equal(new Wthaiq('sk_test_0000').isTestMode(), true);
assert.match(VERSION, /^\d+\.\d+\.\d+/);
const header = Webhook.generateTestHeader({ payload: '{"id":"evt_1","object":"event"}', secret: 'whsec_x' });
assert.equal(Webhook.constructEvent('{"id":"evt_1","object":"event"}', header, 'whsec_x').id, 'evt_1');
console.log('CommonJS build OK');

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_TYPES, isEventType, NotFoundError, type Wthaiq } from '../src/index.js';
import { apiError, json, list, makeClient, path, query, signatureRequest } from './helpers.js';

interface Case {
  name: string;
  call: (wt: Wthaiq) => PromiseLike<unknown>;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  response: unknown;
  status?: number;
}

const tplParams = {
  name: 'Service agreement',
  content: '<p>{{amount}}</p>',
  fields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }],
};
const createParams = {
  source: { type: 'template' as const, template_id: 'tpl_998488' },
  signers: [{ name: 'Noha', email: 'noha@example.com', require_identity: true }],
  legal_level: 'aes' as const,
  send: false,
};

const cases: Case[] = [
  {
    name: 'account.retrieve',
    call: (wt) => wt.account.retrieve(),
    method: 'GET',
    path: '/',
    response: { object: 'api_root' },
  },
  {
    name: 'usage.retrieve',
    call: (wt) => wt.usage.retrieve(),
    method: 'GET',
    path: '/usage',
    response: { object: 'usage' },
  },
  {
    name: 'balance.retrieve',
    call: (wt) => wt.balance.retrieve(),
    method: 'GET',
    path: '/balance',
    response: { object: 'balance' },
  },
  {
    name: 'templates.create',
    call: (wt) => wt.templates.create(tplParams),
    method: 'POST',
    path: '/templates',
    body: tplParams,
    response: { id: 'tpl_1', object: 'template' },
    status: 201,
  },
  {
    name: 'templates.retrieve',
    call: (wt) => wt.templates.retrieve('tpl_1', { include: 'content' }),
    method: 'GET',
    path: '/templates/tpl_1',
    query: { include: 'content' },
    response: { id: 'tpl_1', object: 'template' },
  },
  {
    name: 'templates.list',
    call: (wt) => wt.templates.list({ scope: 'mine', limit: 10 }),
    method: 'GET',
    path: '/templates',
    query: { scope: 'mine', limit: '10' },
    response: list([]),
  },
  {
    name: 'signatureRequests.create',
    call: (wt) => wt.signatureRequests.create(createParams),
    method: 'POST',
    path: '/signature_requests',
    body: createParams,
    response: signatureRequest(),
    status: 201,
  },
  {
    name: 'signatureRequests.createBulk',
    call: (wt) =>
      wt.signatureRequests.createBulk({ source: createParams.source, recipients: createParams.signers }),
    method: 'POST',
    path: '/signature_requests/bulk',
    body: { source: createParams.source, recipients: createParams.signers },
    response: { object: 'bulk_send', created: 1, failed: 0, requests: [], errors: [] },
    status: 201,
  },
  {
    name: 'signatureRequests.retrieve',
    call: (wt) => wt.signatureRequests.retrieve('sr_1'),
    method: 'GET',
    path: '/signature_requests/sr_1',
    response: signatureRequest('sr_1'),
  },
  {
    name: 'signatureRequests.list',
    call: (wt) => wt.signatureRequests.list({ status: 'draft' }),
    method: 'GET',
    path: '/signature_requests',
    query: { status: 'draft' },
    response: list([signatureRequest()]),
  },
  {
    name: 'signatureRequests.send',
    call: (wt) => wt.signatureRequests.send('sr_1'),
    method: 'POST',
    path: '/signature_requests/sr_1/send',
    body: {},
    response: signatureRequest('sr_1', 'sent'),
  },
  {
    name: 'signatureRequests.remind',
    call: (wt) => wt.signatureRequests.remind('sr_1'),
    method: 'POST',
    path: '/signature_requests/sr_1/reminders',
    body: {},
    response: { object: 'reminder', signature_request: 'sr_1', reminders_sent: 1 },
  },
  {
    name: 'signatureRequests.cancel',
    call: (wt) => wt.signatureRequests.cancel('sr_1'),
    method: 'POST',
    path: '/signature_requests/sr_1/cancel',
    body: {},
    response: signatureRequest('sr_1', 'canceled'),
  },
  {
    name: 'signatureRequests.listEvents',
    call: (wt) => wt.signatureRequests.listEvents('sr_1'),
    method: 'GET',
    path: '/signature_requests/sr_1/events',
    response: list([{ id: 'evt_1', object: 'event', type: 'audit.created' }]),
  },
  {
    name: 'signatureRequests.certificate',
    call: (wt) => wt.signatureRequests.certificate('sr_1'),
    method: 'GET',
    path: '/signature_requests/sr_1/certificate',
    response: { object: 'certificate' },
  },
  {
    name: 'signatureRequests.download',
    call: (wt) => wt.signatureRequests.download('sr_1'),
    method: 'GET',
    path: '/signature_requests/sr_1/download',
    response: { object: 'download', pdf_status: 'ready' },
  },
  {
    name: 'signatureRequests.evidence',
    call: (wt) => wt.signatureRequests.evidence('sr_1'),
    method: 'GET',
    path: '/signature_requests/sr_1/evidence',
    response: { object: 'evidence', seal: null },
  },
  {
    name: 'sessions.create',
    call: (wt) =>
      wt.sessions.create({
        workflow_id: 'default',
        template_id: 'tpl_1',
        channel: 'link',
        signers: [{ name: 'N', email: 'n@x.test' }],
      }),
    method: 'POST',
    path: '/sessions',
    body: {
      workflow_id: 'default',
      template_id: 'tpl_1',
      channel: 'link',
      signers: [{ name: 'N', email: 'n@x.test' }],
    },
    response: { id: 'sr_2', object: 'session' },
    status: 201,
  },
  {
    name: 'sessions.retrieve',
    call: (wt) => wt.sessions.retrieve('sr_2'),
    method: 'GET',
    path: '/sessions/sr_2',
    response: { id: 'sr_2', object: 'session' },
  },
  {
    name: 'sessions.list',
    call: (wt) => wt.sessions.list({ workflow_id: 'default', vendor_data: 'user-42' }),
    method: 'GET',
    path: '/sessions',
    query: { workflow_id: 'default', vendor_data: 'user-42' },
    response: list([]),
  },
  {
    name: 'signers.retrieve',
    call: (wt) => wt.signers.retrieve('sgr_1'),
    method: 'GET',
    path: '/signers/sgr_1',
    response: { id: 'sgr_1', object: 'signer' },
  },
  {
    name: 'signers.createSigningSession',
    call: (wt) =>
      wt.signers.createSigningSession('sgr_1', { mode: 'redirect', success_url: 'https://example.com/ok' }),
    method: 'POST',
    path: '/signers/sgr_1/signing_session',
    body: { mode: 'redirect', success_url: 'https://example.com/ok' },
    response: { object: 'signing_session' },
    status: 201,
  },
  {
    name: 'signers.createSigningSession (defaults)',
    call: (wt) => wt.signers.createSigningSession('sgr_1'),
    method: 'POST',
    path: '/signers/sgr_1/signing_session',
    body: {},
    response: { object: 'signing_session' },
    status: 201,
  },
  {
    name: 'documents.retrieve',
    call: (wt) => wt.documents.retrieve('doc_1'),
    method: 'GET',
    path: '/documents/doc_1',
    response: { id: 'doc_1', object: 'document' },
  },
  {
    name: 'identityVerifications.retrieve',
    call: (wt) => wt.identityVerifications.retrieve('idv_12'),
    method: 'GET',
    path: '/identity_verifications/idv_12',
    response: { id: 'idv_12', object: 'identity_verification' },
  },
  {
    name: 'verifications.retrieve',
    call: (wt) => wt.verifications.retrieve('WTQ-1A2B'),
    method: 'GET',
    path: '/verifications/WTQ-1A2B',
    response: { object: 'verification', found: true },
  },
  {
    name: 'webhookEndpoints.create',
    call: (wt) =>
      wt.webhookEndpoints.create({ url: 'https://example.com/hooks', enabled_events: ['signer.signed'] }),
    method: 'POST',
    path: '/webhook_endpoints',
    body: { url: 'https://example.com/hooks', enabled_events: ['signer.signed'] },
    response: { id: 'we_1', object: 'webhook_endpoint', secret: 'whsec_x' },
    status: 201,
  },
  {
    name: 'webhookEndpoints.retrieve',
    call: (wt) => wt.webhookEndpoints.retrieve('we_1'),
    method: 'GET',
    path: '/webhook_endpoints/we_1',
    response: { id: 'we_1', object: 'webhook_endpoint' },
  },
  {
    name: 'webhookEndpoints.update',
    call: (wt) => wt.webhookEndpoints.update('we_1', { status: 'disabled' }),
    method: 'POST',
    path: '/webhook_endpoints/we_1',
    body: { status: 'disabled' },
    response: { id: 'we_1', object: 'webhook_endpoint', status: 'disabled' },
  },
  {
    name: 'webhookEndpoints.delete',
    call: (wt) => wt.webhookEndpoints.delete('we_1'),
    method: 'DELETE',
    path: '/webhook_endpoints/we_1',
    response: { id: 'we_1', object: 'webhook_endpoint', deleted: true },
  },
  {
    name: 'webhookEndpoints.list',
    call: (wt) => wt.webhookEndpoints.list({ limit: 50 }),
    method: 'GET',
    path: '/webhook_endpoints',
    query: { limit: '50' },
    response: list([]),
  },
  {
    name: 'webhookEndpoints.deliveries',
    call: (wt) => wt.webhookEndpoints.deliveries('we_1'),
    method: 'GET',
    path: '/webhook_endpoints/we_1/deliveries',
    response: list([]),
  },
  {
    name: 'webhookEndpoints.test',
    call: (wt) => wt.webhookEndpoints.test('we_1'),
    method: 'POST',
    path: '/webhook_endpoints/we_1/test',
    body: {},
    response: { object: 'webhook_test', ok: true },
  },
  {
    name: 'events.retrieve',
    call: (wt) => wt.events.retrieve('evt_1'),
    method: 'GET',
    path: '/events/evt_1',
    response: { id: 'evt_1', object: 'event' },
  },
  {
    name: 'events.list',
    call: (wt) => wt.events.list({ type: 'signature_request.completed', limit: 3 }),
    method: 'GET',
    path: '/events',
    query: { type: 'signature_request.completed', limit: '3' },
    response: list([]),
  },
  {
    name: 'events.redeliver',
    call: (wt) => wt.events.redeliver('evt_1', { endpoint: 'we_1' }),
    method: 'POST',
    path: '/events/evt_1/redeliver',
    body: { endpoint: 'we_1' },
    response: { object: 'event_redelivery', deliveries: [] },
  },
  {
    name: 'events.redeliver (all endpoints)',
    call: (wt) => wt.events.redeliver('evt_1'),
    method: 'POST',
    path: '/events/evt_1/redeliver',
    body: {},
    response: { object: 'event_redelivery', deliveries: [] },
  },
  {
    name: 'flows.list',
    call: (wt) => wt.flows.list(),
    method: 'GET',
    path: '/flows',
    response: list([{ id: 'flow_1', object: 'flow' }]),
  },
  {
    name: 'flows.retrieve',
    call: (wt) => wt.flows.retrieve('flow_1'),
    method: 'GET',
    path: '/flows/flow_1',
    response: { id: 'flow_1', object: 'flow' },
  },
];

describe('resources', () => {
  for (const c of cases) {
    it(`${c.name} → ${c.method} ${c.path}`, async () => {
      const { wt, mock } = makeClient();
      mock.push(json(c.status ?? 200, c.response));
      const result = (await c.call(wt)) as Record<string, unknown>;
      const request = mock.last;
      assert.equal(request.method, c.method);
      assert.equal(path(request), c.path);
      assert.deepEqual(query(request), c.query ?? {});
      if (c.method === 'POST') {
        assert.deepEqual(JSON.parse(String(request.body)), c.body);
        assert.ok(request.headers['Idempotency-Key']);
      } else {
        assert.equal(request.body, undefined);
        assert.equal(request.headers['Idempotency-Key'], undefined);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(result)), c.response);
      assert.equal(
        (result as { lastResponse: { statusCode: number } }).lastResponse.statusCode,
        c.status ?? 200,
      );
    });
  }

  it('lists every event type', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'list', data: [...EVENT_TYPES, 42] }));
    const types = await wt.webhookEndpoints.eventTypes();
    assert.deepEqual(types, [...EVENT_TYPES]);
    assert.equal(path(mock.last), '/webhook_endpoints/event_types');
    assert.equal(EVENT_TYPES.length, 19);
    assert.equal(isEventType('signer.signed'), true);
    assert.equal(isEventType('signer.unknown'), false);
    mock.push(json(200, { object: 'list' }));
    await assert.rejects(() => wt.webhookEndpoints.eventTypes(), /event type list/);
  });

  it('returns found=false for an unknown verification reference', async () => {
    const { wt, mock } = makeClient();
    const body = {
      object: 'verification',
      reference: 'WTQ-NOPE',
      found: false,
      status: 'not_found',
      integrity: 'unknown',
    };
    mock.push(json(404, body));
    const verification = await wt.verifications.retrieve('WTQ-NOPE');
    assert.equal(verification.found, false);
    assert.equal(verification.status, 'not_found');
    assert.equal(verification.lastResponse.statusCode, 404);
    assert.deepEqual(JSON.parse(JSON.stringify(verification)), body);
  });

  it('still throws NotFoundError for a 404 error envelope on verifications', async () => {
    const { wt, mock } = makeClient();
    mock.push(apiError(404, 'resource_missing'), json(404, '<html>not found</html>'));
    await assert.rejects(() => wt.verifications.retrieve('WTQ-X'), NotFoundError);
    await assert.rejects(() => wt.verifications.retrieve('WTQ-X'), NotFoundError);
  });

  it('narrows webhook events by type', async () => {
    const { wt, mock } = makeClient();
    mock.push(
      json(200, {
        id: 'evt_1',
        object: 'event',
        type: 'signer.signed',
        created_at: 1,
        livemode: false,
        data: { object: { id: 'sgr_1', object: 'signer', signature_request: 'sr_1' } },
      }),
    );
    const event = await wt.events.retrieve('evt_1');
    if (event.type === 'signer.signed') {
      assert.equal(event.data.object.signature_request, 'sr_1');
    } else {
      assert.fail('expected signer.signed');
    }
    assert.equal(query(mock.last)['x'], undefined);
  });
});

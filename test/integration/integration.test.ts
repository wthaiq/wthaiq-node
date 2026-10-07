/**
 * Integration suite: runs against a real Wthaiq API with a TEST secret key only.
 *
 *   WTHAIQ_API_KEY=sk_test_... WTHAIQ_API_BASE=https://wthaiq.com/api/v1 npm run test:integration
 *
 * Optional: WTHAIQ_API_KEY_READONLY (a read-only test key), WTHAIQ_TEST_SIGNER_EMAIL (defaults to the
 * account email; test mode only accepts the account's own addresses), WTHAIQ_TEST_WEBHOOK_URL.
 * Everything created is canceled or deleted at the end. Test mode sends no real messages.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import {
  API_VERSION,
  AuthenticationError,
  ConflictError,
  EVENT_TYPES,
  InvalidRequestError,
  NotFoundError,
  PermissionError,
  ValidationError,
  Wthaiq,
  type Account,
  type Template,
  type WthaiqResponse,
} from '../../src/index.js';

const apiKey = process.env['WTHAIQ_API_KEY'] ?? '';
const baseUrl = process.env['WTHAIQ_API_BASE'] ?? '';
const enabled = apiKey !== '' && baseUrl !== '';
if (enabled && !apiKey.startsWith('sk_test_')) {
  throw new Error('The integration suite only runs with a test secret key (sk_test_...).');
}

const TEMPLATE_NAME = 'SDK integration (wthaiq-node)';

describe(
  'integration (test mode)',
  { skip: enabled ? false : 'set WTHAIQ_API_KEY (sk_test_...) and WTHAIQ_API_BASE' },
  () => {
    let wt: Wthaiq;
    let account: WthaiqResponse<Account>;
    let template: Template;
    let signerEmail: string;
    const toCancel = new Set<string>();
    const toDelete = new Set<string>();

    before(async () => {
      wt = new Wthaiq(apiKey, { baseUrl, maxRetries: 1, appInfo: { name: 'wthaiq-node-integration' } });
      account = await wt.account.retrieve();
      signerEmail = process.env['WTHAIQ_TEST_SIGNER_EMAIL'] ?? account.account.email ?? '';
      assert.notEqual(signerEmail, '', 'the account email is needed as the test signer');
    });

    after(async () => {
      for (const id of toCancel) {
        try {
          await wt.signatureRequests.cancel(id);
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
        }
      }
      for (const id of toDelete) {
        try {
          await wt.webhookEndpoints.delete(id);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
    });

    it('reads the account, usage and balance', async () => {
      assert.equal(account.object, 'api_root');
      assert.equal(account.livemode, false);
      assert.equal(account.version, API_VERSION);
      assert.match(account.account.id, /^acct_\d+$/);
      assert.equal(account.lastResponse.statusCode, 200);
      assert.equal(account.lastResponse.apiVersion, API_VERSION);
      assert.match(account.lastResponse.requestId ?? '', /^req_[0-9a-f]{18}$/);
      assert.ok(account.lastResponse.rateLimit !== null, 'rate limit headers are sent');

      const usage = await wt.usage.retrieve();
      assert.equal(usage.object, 'usage');
      assert.ok(['EGP', 'USD'].includes(usage.balance.currency));
      assert.equal(typeof usage.signature_requests.total, 'number');
      assert.equal(typeof usage.pricing.min_topup.amount_minor, 'number');

      const balance = await wt.balance.retrieve();
      assert.equal(balance.object, 'balance');
      assert.equal(typeof balance.balance.amount_minor, 'number');
    });

    it('finds or creates its template, retrieves it with content and lists own templates', async () => {
      let found: Template | undefined;
      for await (const item of wt.templates.list({ scope: 'mine', search: TEMPLATE_NAME, limit: 100 })) {
        if (item.name === TEMPLATE_NAME) found = item;
      }
      if (found === undefined) {
        const created = await wt.templates.create({
          name: TEMPLATE_NAME,
          content: '<p>أقرّ أنا {{signer_name}} بقبول مبلغ {{amount}}.</p>',
          fields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }],
        });
        assert.equal(created.lastResponse.statusCode, 201);
        found = created;
      }
      template = found;
      assert.match(template.id, /^tpl_\d+$/);
      const withContent = await wt.templates.retrieve(template.id, { include: 'content' });
      assert.equal(withContent.id, template.id);
      assert.ok(withContent.content?.includes('{{amount}}'));
      assert.ok(withContent.fields.some((field) => field.key === 'amount'));
      const mine = await wt.templates.list({ scope: 'mine', limit: 100 });
      assert.ok(mine.data.some((item) => item.id === template.id));
      const catalogue = await wt.templates.list({ limit: 2 });
      assert.ok(catalogue.data.length <= 2);
    });

    it('runs a signature request lifecycle on a draft', async () => {
      const params = {
        title: 'SDK integration draft (node)',
        source: { type: 'template' as const, template_id: template.id },
        signers: [{ name: 'SDK Signer', email: signerEmail, fields: { amount: '100' } }],
        metadata: { suite: 'wthaiq-node', path: '/a/b' },
        reminders: { enabled: true, interval_hours: 48, max: 3 },
        send: false,
      };
      const key = `sdk-node-it-${randomBytes(8).toString('hex')}`;
      const draft = await wt.signatureRequests.create(params, { idempotencyKey: key });
      toCancel.add(draft.id);
      assert.match(draft.id, /^sr_[0-9a-f]{20}$/);
      assert.equal(draft.status, 'draft');
      assert.equal(draft.livemode, false);
      assert.equal(draft.signers[0]?.object, 'signer');
      assert.equal(draft.signers[0]?.signing_url, null, 'draft links stay hidden until sent');
      assert.equal(draft.metadata['path'], '/a/b');
      assert.equal(draft.lastResponse.idempotentReplayed, false);

      const replay = await wt.signatureRequests.create(params, { idempotencyKey: key });
      assert.equal(replay.id, draft.id);
      assert.equal(replay.lastResponse.idempotentReplayed, true);

      await assert.rejects(
        () => wt.signatureRequests.create({ ...params, title: 'changed' }, { idempotencyKey: key }),
        (error: unknown) => error instanceof ConflictError && error.code === 'idempotency_key_reused',
      );

      assert.equal((await wt.signatureRequests.retrieve(draft.id)).id, draft.id);
      const page = await wt.signatureRequests.list({ status: 'draft', limit: 5 });
      assert.ok(page.data.some((item) => item.id === draft.id));

      let seen = 0;
      for await (const item of wt.signatureRequests.list({ limit: 1 })) {
        assert.match(item.id, /^sr_/);
        if (++seen === 3) break;
      }
      assert.ok(seen >= 1);
      assert.equal((await wt.signatureRequests.all({ limit: 2 }).toArray(3)).length <= 3, true);

      const events = await wt.signatureRequests.listEvents(draft.id);
      assert.equal(events.data[0]?.type, 'audit.created');

      const certificate = await wt.signatureRequests.certificate(draft.id);
      assert.equal(certificate.object, 'certificate');
      assert.equal(certificate.test, true);
      assert.equal(certificate.legal_effect, 'none');

      const evidence = await wt.signatureRequests.evidence(draft.id);
      assert.equal(evidence.format, 'wthaiq-evidence-test-v1');
      assert.equal(evidence.seal, null);
      assert.equal(typeof evidence.issued_at, 'string');

      for (const call of [
        () => wt.signatureRequests.download(draft.id),
        () => wt.signatureRequests.downloadPdf(draft.id),
        () => wt.signatureRequests.downloadPdfStream(draft.id),
        () => wt.signatureRequests.remind(draft.id),
      ]) {
        await assert.rejects(
          call,
          (error: unknown) => error instanceof ValidationError && error.statusCode === 400,
        );
      }

      const canceled = await wt.signatureRequests.cancel(draft.id);
      assert.equal(canceled.status, 'canceled');
      await assert.rejects(
        () => wt.signatureRequests.cancel(draft.id),
        (error: unknown) => error instanceof ConflictError && error.code === 'request_not_cancelable',
      );
    });

    it('reports validation errors with the parameter', async () => {
      await assert.rejects(
        () =>
          wt.signatureRequests.create({
            source: { type: 'template', template_id: template.id },
            send: false,
          } as never),
        (error: unknown) => {
          assert.ok(error instanceof ValidationError);
          assert.equal(error.code, 'parameter_missing');
          assert.equal(error.param, 'signers');
          assert.ok('signers' in error.fieldErrors);
          assert.match(error.requestId ?? '', /^req_/);
          return true;
        },
      );
      await assert.rejects(
        () =>
          wt.signatureRequests.create({
            source: { type: 'template', template_id: template.id },
            signers: [{ name: 'Someone', email: 'not-an-email' }],
            send: false,
          }),
        (error: unknown) => error instanceof ValidationError && error.param === 'signers[0].email',
      );
      await assert.rejects(
        () =>
          wt.signatureRequests.create({
            source: { type: 'template', template_id: template.id },
            signers: [{ name: 'Someone', email: signerEmail }],
            channel: 'link',
            send: false,
          } as never),
        (error: unknown) =>
          error instanceof ValidationError &&
          error.code === 'parameter_unsupported' &&
          error.param === 'channel',
      );
    });

    it('creates bulk drafts (or reports the missing plan feature)', async () => {
      try {
        const bulk = await wt.signatureRequests.createBulk({
          source: { type: 'template', template_id: template.id },
          recipients: [{ name: 'Bulk Signer', email: signerEmail }],
          fields: { amount: '1' },
          send: false,
        });
        assert.equal(bulk.object, 'bulk_send');
        assert.equal(bulk.created, 1);
        assert.equal(bulk.failed, 0);
        const id = bulk.requests[0]?.signature_request ?? '';
        toCancel.add(id);
        assert.equal((await wt.signatureRequests.retrieve(id)).status, 'draft');
      } catch (error) {
        assert.ok(error instanceof PermissionError && error.isPlanFeatureUnavailable(), String(error));
      }
    });

    it('creates a session, reads its signer and opens an embedded signing link', async () => {
      const vendor = `sdk-node-${randomBytes(4).toString('hex')}`;
      const session = await wt.sessions.create({
        workflow_id: 'default',
        template_id: template.id,
        channel: 'link',
        language: 'en',
        vendor_data: vendor,
        signers: [{ name: 'Session Signer', email: signerEmail }],
        fields: { amount: '5' },
      });
      toCancel.add(session.id);
      assert.equal(session.object, 'session');
      assert.equal(session.workflow_id, 'default');
      assert.equal(session.channel, 'link');
      assert.equal(session.vendor_data, vendor);
      assert.ok(session.sign_url?.includes('token='));
      assert.equal((await wt.sessions.retrieve(session.id)).id, session.id);
      const found = await wt.sessions.list({ vendor_data: vendor });
      assert.deepEqual(
        found.data.map((item) => item.id),
        [session.id],
      );

      const signerId = session.signers[0]?.id ?? '';
      const signer = await wt.signers.retrieve(signerId);
      assert.equal(signer.id, signerId);
      assert.equal(signer.status, 'sent');
      try {
        const embedded = await wt.signers.createSigningSession(signerId);
        assert.equal(embedded.mode, 'iframe');
        assert.ok(embedded.signing_url.includes('/embed/sign/'));
        assert.ok(embedded.expires_at > Date.now() / 1000);
      } catch (error) {
        assert.ok(error instanceof PermissionError && error.isPlanFeatureUnavailable(), String(error));
      }

      await assert.rejects(
        () => wt.signatureRequests.remind(session.id),
        (error: unknown) => error instanceof ValidationError && error.code === 'channel_has_no_messages',
      );
      await assert.rejects(
        () =>
          wt.sessions.create({
            workflow_id: 'default',
            template_id: template.id,
            ordered: true,
            signers: [{ name: 'X', email: signerEmail }],
          } as never),
        (error: unknown) =>
          error instanceof ValidationError && error.code === 'invalid_override' && error.param === 'ordered',
      );
      await assert.rejects(
        () =>
          wt.sessions.create({
            workflow_id: 'wf_doesnotexist',
            signers: [{ name: 'X', email: signerEmail }],
          }),
        (error: unknown) => error instanceof NotFoundError && error.code === 'workflow_not_found',
      );
      assert.equal((await wt.signatureRequests.cancel(session.id)).status, 'canceled');
    });

    it('manages webhook endpoints and reads events', async (t) => {
      assert.deepEqual(await wt.webhookEndpoints.eventTypes(), [...EVENT_TYPES]);
      const url = process.env['WTHAIQ_TEST_WEBHOOK_URL'] ?? 'https://example.com/wthaiq-sdk-node-integration';
      let endpointId: string;
      try {
        const endpoint = await wt.webhookEndpoints.create({ url, enabled_events: ['document.sealed'] });
        endpointId = endpoint.id;
        toDelete.add(endpoint.id);
        assert.match(endpoint.id, /^we_/);
        assert.match(endpoint.secret ?? '', /^whsec_[0-9a-f]{48}$/);
        assert.deepEqual(endpoint.enabled_events, ['document.sealed']);
        assert.equal(endpoint.livemode, false);
      } catch (error) {
        if (error instanceof ValidationError && error.param === 'url') {
          t.skip(`the API could not accept the webhook URL (DNS lookup failed?): ${error.message}`);
          return;
        }
        throw error;
      }

      const fetched = await wt.webhookEndpoints.retrieve(endpointId);
      assert.equal(fetched.secret, undefined, 'the secret is only returned at creation');
      assert.ok((await wt.webhookEndpoints.list()).data.some((item) => item.id === endpointId));
      const updated = await wt.webhookEndpoints.update(endpointId, {
        status: 'disabled',
        enabled_events: ['document.sealed', 'verification.created'],
      });
      assert.equal(updated.status, 'disabled');
      assert.equal(updated.enabled_events.length, 2);
      assert.equal((await wt.webhookEndpoints.deliveries(endpointId)).data.length, 0);
      await assert.rejects(
        () => wt.webhookEndpoints.create({ url, enabled_events: ['not.a_type' as never] }),
        (error: unknown) => error instanceof ValidationError && error.param === 'enabled_events',
      );
      const deleted = await wt.webhookEndpoints.delete(endpointId);
      assert.equal(deleted.deleted, true);
      toDelete.delete(endpointId);
      await assert.rejects(
        () => wt.webhookEndpoints.retrieve(endpointId),
        (error: unknown) => error instanceof NotFoundError && error.code === 'resource_missing',
      );

      const events = await wt.events.list({ limit: 3 });
      assert.ok(events.data.length <= 3);
      const first = events.data[0];
      if (first !== undefined) {
        assert.equal((await wt.events.retrieve(first.id)).id, first.id);
        await assert.rejects(
          () => wt.events.redeliver(first.id),
          (error: unknown) =>
            error instanceof InvalidRequestError ||
            (error instanceof Error && error.name === 'RateLimitError'),
        );
      }
    });

    it('handles lookups and authentication errors', async () => {
      const verification = await wt.verifications.retrieve('WTQ-SDKNOTFOUND');
      assert.equal(verification.found, false);
      assert.equal(verification.status, 'not_found');
      await assert.rejects(
        () => wt.identityVerifications.retrieve('idv_999999999'),
        (error: unknown) => error instanceof NotFoundError && error.code === 'resource_missing',
      );
      await assert.rejects(() => wt.documents.retrieve('doc_doesnotexist000000'), NotFoundError);
      assert.equal((await wt.flows.list()).object, 'list');

      const bad = new Wthaiq('sk_test_' + '0'.repeat(40), { baseUrl, maxRetries: 0 });
      await assert.rejects(
        () => bad.account.retrieve(),
        (error: unknown) => error instanceof AuthenticationError && error.code === 'invalid_api_key',
      );

      const readOnly = process.env['WTHAIQ_API_KEY_READONLY'] ?? '';
      if (readOnly !== '') {
        const ro = new Wthaiq(readOnly, { baseUrl, maxRetries: 0 });
        assert.equal((await ro.account.retrieve()).object, 'api_root');
        await assert.rejects(
          () => ro.templates.create({ name: 'x', content: '<p>x</p>' }),
          (error: unknown) => error instanceof PermissionError && error.code === 'forbidden',
        );
      }
    });
  },
);

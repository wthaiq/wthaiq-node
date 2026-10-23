# Wthaiq Node.js Library

> مكتبة Node.js الرسمية لواجهة الربط البرمجية في منصة وثائق للتوقيع الإلكتروني. تتيح لتطبيقك إنشاء طلبات التوقيع
> وإرسالها ومتابعة حالتها، واستعمال القوالب ومسارات العمل، وتضمين التوقيع في موقعك، وتنزيل الوثيقة النهائية ومحضر
> الأدلّة، والتحقّق من توقيع إشعارات الأحداث (Webhooks). وتعمل المكتبة في وضع الاختبار مجانًا دون أن تُرسَل أيّ رسالة
> إلى طرف آخر، ثم تنتقل إلى الوضع الحيّ بتغيير المفتاح وحده.

The official Node.js library for the [Wthaiq](https://developers.wthaiq.com) e-signature API. Create and send
signature requests, use templates and workflows, embed signing in your site, download the signed PDF and the
sealed evidence record, and verify webhook signatures.

- Written in TypeScript with complete type definitions; ships ESM and CommonJS builds.
- Zero runtime dependencies: uses the built-in `fetch` (Node.js 18+), or any `fetch` you pass in.
- Typed errors, automatic retries with backoff, automatic idempotency keys, timeouts and `AbortSignal`.
- Auto-pagination with `for await`, verified PDF downloads, and synchronous webhook verification.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Authentication and modes](#authentication-and-modes)
- [Configuration](#configuration)
- [Resources](#resources)
- [Responses](#responses)
- [Pagination](#pagination)
- [Error handling](#error-handling)
- [Retries, idempotency and timeouts](#retries-idempotency-and-timeouts)
- [Webhooks](#webhooks)
- [TypeScript](#typescript)
- [Custom fetch](#custom-fetch)
- [Versioning](#versioning)
- [Support and security](#support-and-security)

## Installation

```bash
npm install wthaiq
```

Requirements: Node.js 18 or later. The library has no runtime dependencies.

## Quick start

```js
import Wthaiq from 'wthaiq';

const wt = new Wthaiq(process.env.WTHAIQ_API_KEY);

const sr = await wt.signatureRequests.create({
  title: 'Employment contract',
  source: { type: 'template', template_id: 'tpl_123' },
  legal_level: 'aes',
  signers: [{ name: 'Ahmed Ali', email: 'ahmed@example.com', method: 'draw', require_identity: true }],
});

console.log(sr.id, sr.status); // sr_3f1c… sent
```

More runnable examples (creating requests, pagination, embedded signing, downloads, error handling and
webhook receivers for plain Node.js, Express and Next.js) are in [`examples/`](examples).

CommonJS:

```js
const { Wthaiq } = require('wthaiq');
const wt = new Wthaiq(process.env.WTHAIQ_API_KEY);
```

## Authentication and modes

Create API keys in the developer portal at <https://developers.wthaiq.com>. The key decides the mode:

| Key         | Mode | Effect                                                                                      |
| ----------- | ---- | ------------------------------------------------------------------------------------------- |
| `sk_test_…` | Test | Free. No message reaches anyone, documents carry a test watermark and have no legal effect. |
| `sk_…`      | Live | Requests are really sent and billed to your plan quota and wallet.                          |

```js
wt.isTestMode(); // true for sk_test_ / pk_test_ keys
wt.isLiveMode();
```

Test mode accepts only the account's own addresses (and active team members) as signers, allows up to 5
signers per request and 20 created requests per 24 hours. Live mode needs a paid plan and a verified company;
otherwise the API answers `402 plan_required` or `403 kyb_required`.

Use this library on your server with a secret key. Publishable keys (`pk_…`) are accepted but only work on the
few routes the embeddable console needs, from the origins configured for the key.

## Configuration

```js
const wt = new Wthaiq('sk_test_...', {
  baseUrl: 'https://wthaiq.com/api/v1', // default
  timeout: 60_000, // ms per attempt, default 60000
  maxRetries: 2, // default 2 (3 attempts in total)
  apiVersion: '2026-07-01', // sent as Wthaiq-Version
  appInfo: { name: 'MyApp', version: '1.4.0', url: 'https://myapp.example' }, // appended to User-Agent
  language: 'en', // error messages in English (sent as Accept-Language); default: no header, Arabic
  retryPolicy: { initialDelay: 500, maxDelay: 8000, maxRetryAfter: 60_000 }, // ms
  fetch: customFetch, // optional, see "Custom fetch"
});

// Or a single object:
const wt2 = new Wthaiq({ apiKey: process.env.WTHAIQ_API_KEY, timeout: 30_000 });
```

Every method accepts a final, optional **request options** object:

```js
await wt.signatureRequests.create(params, {
  idempotencyKey: 'order-1024', // default: a random UUID per call
  timeout: 10_000, // ms, this call only
  maxRetries: 0, // this call only
  apiKey: 'sk_test_other', // another key for this call
  headers: { 'X-Trace-Id': 't-1' }, // extra headers (Authorization is refused: use apiKey)
  signal: AbortSignal.timeout(15_000), // cancel the call and any pending retry
});
```

An invalid key format, an unknown option or a missing id throws `InvalidArgumentError` before anything is sent.

## Resources

Request and response fields use the API's own names (`template_id`, `has_more`, …). Every resource method
returns a promise; list methods return a page promise (see [Pagination](#pagination)).

### Account, usage and balance

```js
const account = await wt.account.retrieve(); // GET /  (account, plan, pricing)
const usage = await wt.usage.retrieve(); // wallet, plan quota, pricing, request counts
const balance = await wt.balance.retrieve();
console.log(account.plan.id, usage.plan.sends_left, balance.balance.amount, balance.balance.currency);
```

### Templates

```js
const tpl = await wt.templates.create({
  name: 'Service agreement',
  content: '<p>I, {{signer_name}}, accept the amount of {{amount}}.</p>',
  fields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }],
});
const full = await wt.templates.retrieve(tpl.id, { include: 'content' });
const mine = await wt.templates.list({ scope: 'mine', search: 'agreement' }); // without scope: the public catalogue
```

### Signature requests

```js
const draft = await wt.signatureRequests.create({
  source: { type: 'template', template_id: 'tpl_123' },
  signers: [
    { name: 'Noha Adel', email: 'noha@example.com', fields: { amount: '25000' } },
    { name: 'Omar Said', phone: '201012345678', type: 'company' },
  ],
  ordered: true,
  cc: ['legal@example.com'],
  reminders: { enabled: true, interval_hours: 48, max: 3 },
  metadata: { order_id: 'A-1024' },
  send: false, // create a draft; send it later
});

await wt.signatureRequests.send(draft.id);
const sr = await wt.signatureRequests.retrieve(draft.id);
await wt.signatureRequests.remind(sr.id); // { reminders_sent: 1 }
await wt.signatureRequests.cancel(sr.id); // status: 'canceled'

const bulk = await wt.signatureRequests.createBulk({
  source: { type: 'template', template_id: 'tpl_123' },
  recipients: [
    { name: 'A', email: 'a@example.com' },
    { name: 'B', email: 'b@example.com' },
  ],
}); // one request per recipient: { created, failed, requests, errors }

const audit = await wt.signatureRequests.listEvents(sr.id); // audit trail
const certificate = await wt.signatureRequests.certificate(sr.id);
```

When the request is `completed`:

```js
const meta = await wt.signatureRequests.download(sr.id); // pdf_status, pdf_sha256, final_document_url, …
const pdf = await wt.signatureRequests.downloadPdf(sr.id); // Buffer, checked against X-File-Sha256
const saved = await wt.signatureRequests.downloadPdfTo(sr.id, './contract.pdf'); // { path, bytes, sha256 }
const stream = await wt.signatureRequests.downloadPdfStream(sr.id); // { body: ReadableStream, sha256, filename }
const evidence = await wt.signatureRequests.evidence(sr.id); // sealed record (unsealed test record in test mode)
```

A `409 pdf_not_ready` (`ConflictError`) means the PDF is still being generated: retry a little later.

### Sessions (workflows)

A session is a signature request created from a workflow configured in the developer portal (or the built-in
`default` workflow). Its id is the request id, so every `signatureRequests` method works on it.

```js
const session = await wt.sessions.create({
  workflow_id: 'default', // or 'wf_…'
  template_id: 'tpl_123',
  channel: 'link', // 'email' | 'whatsapp' | 'link' (you deliver sign_url)
  language: 'en',
  expires_in: 14, // days
  vendor_data: 'customer-42',
  signers: [{ name: 'Noha Adel', email: 'noha@example.com' }],
});
console.log(session.sign_url);

const found = await wt.sessions.list({ vendor_data: 'customer-42' });
```

### Signers and embedded signing

```js
const signer = await wt.signers.retrieve('sgr_…');
const embed = await wt.signers.createSigningSession(signer.id, { mode: 'iframe' }); // valid for 30 minutes
// <iframe src={embed.signing_url}>
const redirect = await wt.signers.createSigningSession(signer.id, {
  mode: 'redirect',
  success_url: 'https://app.example.com/signed',
  cancel_url: 'https://app.example.com/cancel',
});
```

When the name on a signer's identity document differs from the name in the request, the signer's
`identity.name_match` records it. With the account setting "hold signing until a decision" (the default), the
`signer.identity_match_hold` event arrives, `identity.name_match.state` is `awaiting`, and signing waits for
your decision (secret keys only):

```js
const decided = await wt.signers.decideIdentityMatch('sgr_…', {
  decision: 'approve', // or 'reject' to stop this signer
  note: 'Confirmed by phone', // optional, stored with the decision
});
decided.identity?.name_match?.state; // 'approved'
```

The decision triggers `signer.identity_match_decided`. Both events carry the signer and its `identity_match`.
When nothing awaits a decision the call throws `ConflictError` with the code `identity_match_not_pending`.

### Documents

The API accepts contracts written as text only (in templates or in the request); PDF uploads are no longer accepted.
Documents uploaded earlier can still be retrieved:

```js
await wt.documents.retrieve('doc_1');
```

### Identity verifications and public verification

```js
const idv = await wt.identityVerifications.retrieve('idv_12');

const check = await wt.verifications.retrieve('WTQ-1A2B3C4D5E6F');
if (!check.found) console.log('Unknown reference'); // a 404 lookup resolves with found: false
```

`idv.name_match` holds the same name-match result as the signer's `identity.name_match`, or `null`.

### Webhook endpoints and events

```js
const endpoint = await wt.webhookEndpoints.create({
  url: 'https://example.com/hooks/wthaiq',
  enabled_events: ['signature_request.completed', 'signer.signed'], // or ['*']
});
console.log(endpoint.secret); // whsec_… returned only now: store it

for await (const item of wt.webhookEndpoints.list({ limit: 100 })) console.log(item.id, item.url); // every page
await wt.webhookEndpoints.update(endpoint.id, { status: 'disabled' });
await wt.webhookEndpoints.deliveries(endpoint.id); // last 50 attempts
await wt.webhookEndpoints.test(endpoint.id); // synthetic signature_request.completed
await wt.webhookEndpoints.eventTypes(); // every event type
await wt.webhookEndpoints.delete(endpoint.id);

const events = await wt.events.list({ type: 'signer.signed', limit: 10 });
await wt.events.redeliver('evt_…', { endpoint: 'we_…' });
```

### Flows

```js
const flows = await wt.flows.list();
const flow = await wt.flows.retrieve('flow_…');
```

## Responses

Responses are plain objects with the API's fields. The HTTP details of the call are in the non-enumerable
`lastResponse` property (left out of `JSON.stringify` and object spread):

```js
const sr = await wt.signatureRequests.retrieve('sr_…');
sr.lastResponse.statusCode; // 200
sr.lastResponse.requestId; // 'req_…', quote it to support
sr.lastResponse.idempotentReplayed; // true when replayed from an earlier identical POST
sr.lastResponse.rateLimit; // { limit, remaining, reset } or null
sr.lastResponse.getHeader('Wthaiq-Version');
```

Fields that a newer API version adds are kept as they arrive.

## Pagination

`list()` returns a page promise. Await it for one page, or iterate it with `for await` to walk every item
across pages (the cursor is followed for you):

```js
const page = await wt.signatureRequests.list({ status: 'completed', limit: 100 });
page.data; // items of this page
page.has_more; // more after this page?
const next = await page.getNextPage(); // or null

for await (const sr of wt.signatureRequests.list({ status: 'completed', limit: 100 })) {
  console.log(sr.id, sr.reference);
}

const first50 = await wt.signatureRequests.all({ limit: 100 }).toArray(50);
```

Nothing is sent until the page promise is awaited or iterated. Iteration stops when the API reports no more
pages, on an empty page, or if a cursor repeats.

## Error handling

Every error thrown by the library extends `WthaiqError`. HTTP errors extend `ApiError` and carry `statusCode`,
`code`, `param`, `type`, `requestId`, `error` (the raw error object), `headers` and `rawBody`. Branch on the
class and on `code`; the `message` is human text, in Arabic unless the client option `language: 'en'` asks for
English. Codes never change with the language.

| Class                        | When                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `ValidationError`            | 400: missing or invalid parameter (`param` names the field, `fieldErrors` maps it).         |
| `TooManySignersError`        | 400 `too_many_signers`: more signers than `maxSigners` (5) in one request.                  |
| `AuthenticationError`        | 401: missing, invalid or revoked key, inactive account.                                     |
| `PaymentRequiredError`       | 402: `plan_required`, `plan_expired`, `insufficient_balance` (`upgradeUrl`).                |
| `PermissionError`            | 403: `forbidden`, `plan_feature_unavailable` (`upgradeUrl`), `kyb_required` (`verifyUrl`).  |
| `NotFoundError`              | 404: unknown object, another account's object, or the other mode.                           |
| `ConflictError`              | 409: idempotency conflicts, `request_not_cancelable`, `pdf_not_ready`, `workflow_not_live`. |
| `RateLimitError`             | 429: `too_many_requests` (`retryAfter`) or quota codes such as `test_daily_limit`.          |
| `ServerError`                | 5xx: `internal_error`, `delivery_failed`, `feature_unavailable`.                            |
| `InvalidRequestError`        | Parent of the 400/404/409 classes, and other 4xx such as 405.                               |
| `ApiConnectionError`         | No HTTP response: network failure, timeout (`timedOut`), or your `AbortSignal` (`aborted`). |
| `UnexpectedResponseError`    | The response could not be used (not JSON, not a PDF, PDF fingerprint mismatch).             |
| `SignatureVerificationError` | A webhook signature is missing, invalid or too old.                                         |
| `InvalidArgumentError`       | The library was called incorrectly; nothing was sent.                                       |

```js
import {
  PaymentRequiredError,
  PermissionError,
  RateLimitError,
  TooManySignersError,
  ValidationError,
  WthaiqError,
} from 'wthaiq';

try {
  await wt.signatureRequests.create(params);
} catch (error) {
  if (error instanceof TooManySignersError) {
    console.log(`At most ${error.maxSigners} signers per request: split them over several requests`);
  } else if (error instanceof ValidationError) {
    console.log(`Fix ${error.param}: ${error.message}`);
  } else if (error instanceof PaymentRequiredError) {
    console.log(`Buy or renew a plan: ${error.upgradeUrl}`); // plan_required, plan_expired
  } else if (error instanceof PermissionError && error.isKybRequired()) {
    console.log(`Verify your company first: ${error.verifyUrl}`);
  } else if (error instanceof PermissionError && error.isPlanFeatureUnavailable()) {
    console.log(`Needs ${error.requiredPlan} for ${error.feature}: ${error.upgradeUrl}`);
  } else if (error instanceof RateLimitError) {
    console.log(`Retry after ${error.retryAfter} s`);
  } else if (error instanceof WthaiqError) {
    console.log(error.name, error.message, error.requestId);
  } else {
    throw error;
  }
}
```

All classes are also available as `Wthaiq.errors.ValidationError`, and so on.

## Retries, idempotency and timeouts

- Transient failures are retried automatically, `maxRetries` times (default 2): connection errors and
  timeouts, `429 too_many_requests`, `409 idempotency_in_progress`, `500`, `502` (except `delivery_failed`),
  `503` (except `feature_unavailable`) and `504`. Quota-style 429s (`daily_cap_reached`, `reminder_too_soon`,
  `test_daily_limit`, …) and other 4xx are never retried.
- The delay honours `Retry-After` (capped at 60 seconds), otherwise exponential backoff from 0.5 s up to 8 s
  with jitter.
- Every `POST` carries an `Idempotency-Key`: a random UUID unless you pass `idempotencyKey`. The same key is
  reused for each retry of that call, so a retry never creates a second request. The API keeps keys for 24
  hours; pass your own key (for example your order id) to make a business operation safe to repeat across
  process restarts. A replayed response has `lastResponse.idempotentReplayed === true`.
- `timeout` applies to each attempt, including reading the body. Pass `signal` to cancel a call.

## Webhooks

The platform signs every delivery with your endpoint secret in the `Wthaiq-Signature` header
(`t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>`). `Webhook.constructEvent()` checks the
signature in constant time against the **raw** body, rejects timestamps older than 300 seconds (configurable,
`0` disables), and returns the typed event. It is synchronous and works in Node.js and edge runtimes.

Deliveries can repeat and arrive out of order: dedupe on `event.id` and answer with a 2xx within 10 seconds.

### Express

```js
import express from 'express';
import Wthaiq from 'wthaiq';

const wt = new Wthaiq(process.env.WTHAIQ_API_KEY);
const app = express();

// express.raw keeps the exact bytes; do not run express.json() before this route.
app.post('/hooks/wthaiq', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = wt.webhooks.constructEvent(
      req.body,
      req.headers['wthaiq-signature'],
      process.env.WTHAIQ_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res.status(400).send(`signature check failed: ${err.message}`);
  }
  if (event.type === 'signature_request.completed') {
    const sr = event.data.object; // typed as a signature request
    console.log('completed', sr.id, sr.reference);
  }
  res.json({ received: true });
});
```

### Next.js (App Router)

```ts
// app/api/hooks/wthaiq/route.ts
import { Webhook } from 'wthaiq';

export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const event = Webhook.constructEvent(
      payload,
      request.headers.get('wthaiq-signature'),
      process.env.WTHAIQ_WEBHOOK_SECRET!,
    );
    if (event.type === 'signer.signed')
      console.log(event.data.object.name, event.data.object.signature_request);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  return Response.json({ received: true });
}
```

### Plain Node.js

```js
import { createServer } from 'node:http';
import { Webhook } from 'wthaiq';

createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const event = Webhook.constructEvent(Buffer.concat(chunks), req.headers['wthaiq-signature'], secret);
      console.log(event.type);
      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
  });
}).listen(3000);
```

Other helpers: `Webhook.verifyHeader()` (throws, no decoding), `Webhook.isValid()` (boolean),
`Webhook.computeSignature()` and `Webhook.generateTestHeader({ payload, secret })` to test your own handler.
Several `v1` values in one header (secret rotation) are accepted when any of them matches.

## TypeScript

Types are included for both module systems. Responses are typed per resource, and webhook events narrow on
`type`:

```ts
import Wthaiq, {
  type SignatureRequest,
  type SignatureRequestCreateParams,
  type WthaiqEvent,
  type WthaiqResponse,
} from 'wthaiq';

const params: SignatureRequestCreateParams = {
  source: { type: 'template', template_id: 'tpl_123' },
  signers: [{ name: 'Noha', email: 'noha@example.com' }],
};
const sr: WthaiqResponse<SignatureRequest> = await wt.signatureRequests.create(params);

function handle(event: WthaiqEvent) {
  switch (event.type) {
    case 'signature_request.completed':
      return event.data.object.reference; // SignatureRequest
    case 'signer.declined':
      return event.data.object.signature_request; // signer with its request id
    case 'verification.created':
      return event.data.object.verify_url;
  }
}
```

`EVENT_TYPES` lists every event type and `isEventType()` checks a string at run time.

## Custom fetch

Pass any `fetch`-compatible function, for example to route through a proxy, add logging or record requests
in tests. Never log the `Authorization` header, webhook secrets, or request bodies with personal data.

```js
const wt = new Wthaiq(process.env.WTHAIQ_API_KEY, {
  fetch: async (url, init) => {
    const started = Date.now();
    const response = await fetch(url, init);
    console.log(init.method, url, response.status, `${Date.now() - started} ms`);
    return response;
  },
});
```

## Versioning

The library follows [Semantic Versioning](https://semver.org/). Version 1.x targets API version `2026-07-01`
(sent as `Wthaiq-Version`; available as `Wthaiq.API_VERSION`, and the library version as `Wthaiq.VERSION`).
New endpoints and fields arrive in minor releases; changing the pinned API version, removing anything or
dropping a Node.js version is a major release. See [CHANGELOG.md](CHANGELOG.md).

## Support and security

- Documentation: <https://developers.wthaiq.com/docs>
- Support: support@wthaiq.com (include the `requestId` of the failing call)
- Security issues: please report privately as described in [SECURITY.md](SECURITY.md).
- License: [MIT](LICENSE)

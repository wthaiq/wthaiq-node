// Creates a signature request from a template. With a test key nothing is really sent and it costs nothing.
// The example creates a draft (send: false) and cancels it at the end; remove both to send for real.
import { randomUUID } from 'node:crypto';
import { env, wt } from './client.mjs';

const sr = await wt.signatureRequests.create(
  {
    title: 'Service agreement',
    source: { type: 'template', template_id: env('WTHAIQ_TEMPLATE_ID') },
    legal_level: 'ses',
    signers: [
      {
        name: 'Noha Adel',
        email: env('WTHAIQ_SIGNER_EMAIL'),
        type: 'individual',
        method: 'draw',
        fields: { amount: '25000' },
      },
    ],
    reminders: { enabled: true, interval_hours: 48, max: 3 },
    metadata: { order_id: 'A-1024' },
    send: false,
  },
  // Reuse the same key when you retry the same business operation, so it is never created twice.
  { idempotencyKey: randomUUID() },
);

console.log(
  sr.id,
  sr.status,
  sr.signers.map((s) => `${s.name} <${s.email}>: ${s.status}`),
);
console.log('request id:', sr.lastResponse.requestId);

// Send the draft when you are ready (this is what `send: true`, the default, does at creation):
// await wt.signatureRequests.send(sr.id);

const canceled = await wt.signatureRequests.cancel(sr.id);
console.log('canceled:', canceled.status);

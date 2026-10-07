// Creates a session on the built-in `default` workflow with the `link` channel (nothing is sent: you deliver
// the link), then opens a 30-minute embedded signing link for an iframe. Plan feature `embed` is required for
// iframes; `mode: 'redirect'` with a `success_url` on one of your accepted domains works too.
import { PermissionError } from 'wthaiq';
import { env, wt } from './client.mjs';

const session = await wt.sessions.create({
  workflow_id: 'default',
  template_id: env('WTHAIQ_TEMPLATE_ID'),
  channel: 'link',
  language: 'en',
  vendor_data: 'customer-42',
  signers: [{ name: 'Noha Adel', email: env('WTHAIQ_SIGNER_EMAIL') }],
  fields: { amount: '5000' },
});
console.log('session:', session.id, session.status, session.sign_url);

const signerId = session.signers[0].id;
try {
  const embedded = await wt.signers.createSigningSession(signerId, { mode: 'iframe' });
  console.log(
    'iframe src:',
    embedded.signing_url,
    'expires',
    new Date(embedded.expires_at * 1000).toISOString(),
  );
} catch (error) {
  if (error instanceof PermissionError && error.isPlanFeatureUnavailable()) {
    console.log(`Embedded signing needs a plan with "${error.feature}". Upgrade: ${error.upgradeUrl}`);
  } else {
    throw error;
  }
}

await wt.signatureRequests.cancel(session.id);
console.log('session canceled');

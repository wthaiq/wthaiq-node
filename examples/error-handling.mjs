// Branch on error classes and `error.code`, never on the message text.
import {
  ApiConnectionError,
  AuthenticationError,
  PaymentRequiredError,
  PermissionError,
  RateLimitError,
  ValidationError,
  WthaiqError,
} from 'wthaiq';
import { env, wt } from './client.mjs';

async function attempt(label, fn) {
  try {
    await fn();
    console.log(`${label}: ok`);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log(`${label}: invalid ${error.param ?? 'request'} (${error.code})`, error.fieldErrors);
    } else if (error instanceof AuthenticationError) {
      console.log(`${label}: check the API key (${error.code})`);
    } else if (error instanceof PaymentRequiredError) {
      console.log(`${label}: ${error.code}; buy or renew a plan at ${error.upgradeUrl}`);
    } else if (error instanceof PermissionError) {
      console.log(`${label}: not allowed (${error.code}) ${error.upgradeUrl ?? ''}`);
    } else if (error instanceof RateLimitError) {
      console.log(`${label}: slow down (${error.code}), retry after ${error.retryAfter ?? '?'} s`);
    } else if (error instanceof ApiConnectionError) {
      console.log(`${label}: network problem${error.timedOut ? ' (timeout)' : ''}: ${error.message}`);
    } else if (error instanceof WthaiqError) {
      console.log(`${label}: ${error.name}: ${error.message}`);
    } else {
      throw error;
    }
    if (error.requestId) console.log(`  request id for support: ${error.requestId}`);
  }
}

await attempt('missing signers', () =>
  wt.signatureRequests.create({
    source: { type: 'template', template_id: env('WTHAIQ_TEMPLATE_ID') },
    send: false,
  }),
);
await attempt('invalid email', () =>
  wt.signatureRequests.create({
    source: { type: 'template', template_id: env('WTHAIQ_TEMPLATE_ID') },
    signers: [{ name: 'X', email: 'not-an-email' }],
    send: false,
  }),
);
await attempt('unknown request', () => wt.signatureRequests.retrieve('sr_00000000000000000000'));
await attempt('verification lookup', async () => {
  const result = await wt.verifications.retrieve('WTQ-UNKNOWN');
  console.log('  found:', result.found, result.status);
});

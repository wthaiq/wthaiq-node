// Shared setup for the examples.
//
//   export WTHAIQ_API_KEY=sk_test_...
//   export WTHAIQ_TEMPLATE_ID=tpl_123            # one of your templates (scope: 'mine')
//   export WTHAIQ_SIGNER_EMAIL=you@example.com   # test mode accepts only your account's own addresses
//   node examples/create-signature-request.mjs
//
// Optional: WTHAIQ_API_BASE to point at another environment.
import Wthaiq from 'wthaiq';

export function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`Set the ${name} environment variable first.`);
    process.exit(1);
  }
  return value;
}

export const wt = new Wthaiq(env('WTHAIQ_API_KEY'), {
  ...(process.env.WTHAIQ_API_BASE ? { baseUrl: process.env.WTHAIQ_API_BASE } : {}),
  appInfo: { name: 'wthaiq-node-examples' },
});

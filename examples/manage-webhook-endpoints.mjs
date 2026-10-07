// Creates, updates and deletes a webhook endpoint. Store the secret: it is returned only once.
import { wt } from './client.mjs';

console.log('event types:', (await wt.webhookEndpoints.eventTypes()).join(', '));

const endpoint = await wt.webhookEndpoints.create({
  url: process.env.WTHAIQ_WEBHOOK_URL ?? 'https://example.com/hooks/wthaiq',
  enabled_events: ['signature_request.completed', 'signer.signed'],
});
console.log('created', endpoint.id, 'secret starts with', endpoint.secret?.slice(0, 10));

const updated = await wt.webhookEndpoints.update(endpoint.id, { status: 'disabled' });
console.log('status:', updated.status);

for await (const item of wt.webhookEndpoints.list()) {
  console.log(' -', item.id, item.url, item.status, item.enabled_events.join(','));
}

const deliveries = await wt.webhookEndpoints.deliveries(endpoint.id);
console.log('deliveries:', deliveries.data.length);

const deleted = await wt.webhookEndpoints.delete(endpoint.id);
console.log('deleted:', deleted.deleted);

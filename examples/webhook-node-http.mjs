// A webhook receiver with plain node:http. Verify the signature on the RAW body, then answer 2xx quickly.
//   WTHAIQ_WEBHOOK_SECRET=whsec_... node examples/webhook-node-http.mjs
import { createServer } from 'node:http';
import { Webhook } from 'wthaiq';

const secret = process.env.WTHAIQ_WEBHOOK_SECRET;
if (!secret) {
  console.error('Set WTHAIQ_WEBHOOK_SECRET (the whsec_... value returned when the endpoint was created).');
  process.exit(1);
}

const processed = new Set(); // use your database in production: deliveries can repeat

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/hooks/wthaiq') {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let event;
    try {
      event = Webhook.constructEvent(Buffer.concat(chunks), req.headers['wthaiq-signature'], secret);
    } catch (error) {
      res.writeHead(400).end(`signature check failed: ${error.message}`);
      return;
    }
    if (!processed.has(event.id)) {
      processed.add(event.id);
      if (event.type === 'signature_request.completed') {
        console.log('completed:', event.data.object.id, event.data.object.reference);
      } else if (event.type === 'signer.signed') {
        console.log('signed:', event.data.object.name, 'on', event.data.object.signature_request);
      } else {
        console.log('event:', event.type);
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
  });
}).listen(3000, () => console.log('listening on http://localhost:3000/hooks/wthaiq'));

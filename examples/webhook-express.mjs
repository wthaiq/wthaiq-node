// Express receiver (npm i express). express.raw keeps the body as a Buffer, which the signature needs;
// do not mount express.json() before this route.
import express from 'express';
import Wthaiq from 'wthaiq';

const wt = new Wthaiq(process.env.WTHAIQ_API_KEY);
const app = express();

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
    const sr = event.data.object;
    console.log('completed', sr.id, sr.reference);
  }
  res.json({ received: true });
});

app.listen(3000);

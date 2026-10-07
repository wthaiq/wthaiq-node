// Lists signature requests. `await` gives one page; `for await` walks every page through the cursor.
import { wt } from './client.mjs';

const page = await wt.signatureRequests.list({ limit: 5 });
console.log(`first page: ${page.data.length} item(s), more: ${page.has_more}`);

let count = 0;
for await (const sr of wt.signatureRequests.list({ status: 'canceled', limit: 100 })) {
  console.log(sr.id, sr.status, new Date(sr.created_at * 1000).toISOString(), sr.title);
  if (++count === 20) break; // stop early whenever you like
}

const completed = await wt.signatureRequests.all({ status: 'completed' }).toArray(10);
console.log(`completed (up to 10): ${completed.map((sr) => sr.reference).join(', ') || 'none'}`);

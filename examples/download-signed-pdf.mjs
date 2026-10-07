// Downloads the final PDF of a completed request, verified against the X-File-Sha256 fingerprint.
//   node examples/download-signed-pdf.mjs sr_...
import { ConflictError, NotFoundError, ValidationError } from 'wthaiq';
import { wt } from './client.mjs';

const id = process.argv[2];
if (!id) {
  console.error('Usage: node examples/download-signed-pdf.mjs <signature request id>');
  process.exit(1);
}

try {
  const meta = await wt.signatureRequests.download(id);
  console.log('status:', meta.pdf_status, 'reference:', meta.reference);
  const saved = await wt.signatureRequests.downloadPdfTo(id, `./${meta.reference ?? id}.pdf`);
  console.log(`saved ${saved.bytes} bytes to ${saved.path} (sha256 ${saved.sha256})`);

  const evidence = await wt.signatureRequests.evidence(id);
  console.log('evidence format:', evidence.format, 'sealed:', evidence.seal !== null);
} catch (error) {
  if (error instanceof ConflictError && error.code === 'pdf_not_ready') {
    console.log('The PDF is still being generated. Try again in a minute.');
  } else if (error instanceof NotFoundError) {
    console.log(`No signature request ${id} in this mode (test keys only see test requests).`);
  } else if (error instanceof ValidationError) {
    console.log(`Not available yet (${error.code}): the request must be completed first.`);
  } else {
    throw error;
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { UnexpectedResponseError, ValidationError, WthaiqError } from '../src/index.js';
import { apiError, makeClient, path, PDF_BYTES } from './helpers.js';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'wthaiq-node-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function pdfResponse(headers: Record<string, string> = {}, bytes: Uint8Array = PDF_BYTES): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="WTQ-000123.pdf"',
      'x-file-sha256': sha(bytes),
      'wthaiq-request-id': 'req_pdf',
      ...headers,
    },
  });
}

describe('final PDF download', () => {
  it('returns a verified Buffer', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse({ 'x-file-sha256': sha(PDF_BYTES).toUpperCase() }));
    const pdf = await wt.signatureRequests.downloadPdf('sr_1');
    assert.ok(Buffer.isBuffer(pdf));
    assert.deepEqual(new Uint8Array(pdf), PDF_BYTES);
    assert.equal(pdf.lastResponse.requestId, 'req_pdf');
    assert.equal(path(mock.last), '/signature_requests/sr_1/download/pdf');
    assert.equal(mock.last.headers['Accept'], 'application/pdf');
  });

  it('accepts a PDF without a fingerprint header', async () => {
    const { wt, mock } = makeClient();
    mock.push(new Response(PDF_BYTES, { status: 200 }));
    assert.equal((await wt.signatureRequests.downloadPdf('sr_1')).length, PDF_BYTES.length);
  });

  it('rejects bytes that do not match X-File-Sha256', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse({ 'x-file-sha256': '0'.repeat(64) }));
    await assert.rejects(
      () => wt.signatureRequests.downloadPdf('sr_1'),
      (error: unknown) => {
        return error instanceof UnexpectedResponseError && error.message.includes('X-File-Sha256');
      },
    );
  });

  it('rejects a body that is not a PDF', async () => {
    const { wt, mock } = makeClient();
    mock.push(new Response('{"oops":true}', { status: 200 }));
    await assert.rejects(
      () => wt.signatureRequests.downloadPdf('sr_1'),
      (error: unknown) => {
        return error instanceof UnexpectedResponseError && error.rawBody === '{"oops":true}';
      },
    );
  });

  it('maps errors such as pdf_not_ready and not completed', async () => {
    const { wt, mock } = makeClient();
    mock.push(apiError(409, 'pdf_not_ready'), apiError(400, 'invalid_request'));
    await assert.rejects(() => wt.signatureRequests.downloadPdf('sr_1'), {
      name: 'ConflictError',
      code: 'pdf_not_ready',
    });
    await assert.rejects(() => wt.signatureRequests.downloadPdf('sr_1'), ValidationError);
  });

  it('writes the verified PDF to a file atomically', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse());
    const target = join(dir, 'signed.pdf');
    const saved = await wt.signatureRequests.downloadPdfTo('sr_1', target);
    assert.deepEqual(saved, { path: target, bytes: PDF_BYTES.length, sha256: sha(PDF_BYTES) });
    assert.deepEqual(new Uint8Array(readFileSync(target)), PDF_BYTES);
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes('.part-')),
      [],
    );
  });

  it('overwrites an existing file', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse());
    const target = join(dir, 'existing.pdf');
    writeFileSync(target, 'old');
    await wt.signatureRequests.downloadPdfTo('sr_1', target);
    assert.equal(readFileSync(target).length, PDF_BYTES.length);
  });

  it('reports a write failure and leaves no partial file', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse());
    const target = join(dir, 'missing-dir', 'signed.pdf');
    await assert.rejects(
      () => wt.signatureRequests.downloadPdfTo('sr_1', target),
      (error: unknown) => {
        return error instanceof WthaiqError && error.message.includes('Could not write the PDF');
      },
    );
  });

  it('does not write anything when verification fails', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse({ 'x-file-sha256': 'f'.repeat(64) }));
    const target = join(dir, 'never.pdf');
    await assert.rejects(() => wt.signatureRequests.downloadPdfTo('sr_1', target), UnexpectedResponseError);
    assert.equal(readdirSync(dir).includes('never.pdf'), false);
  });

  it('streams the PDF with its metadata', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse({ 'content-length': String(PDF_BYTES.length) }));
    const stream = await wt.signatureRequests.downloadPdfStream('sr_1');
    assert.equal(stream.filename, 'WTQ-000123.pdf');
    assert.equal(stream.sha256, sha(PDF_BYTES));
    assert.equal(stream.contentLength, PDF_BYTES.length);
    assert.equal(stream.lastResponse.statusCode, 200);
    const chunks: Uint8Array[] = [];
    const reader = stream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    assert.equal(sha(Buffer.concat(chunks)), sha(PDF_BYTES));
  });

  it('parses RFC 5987 file names', async () => {
    const { wt, mock } = makeClient();
    mock.push(pdfResponse({ 'content-disposition': "attachment; filename*=UTF-8''%D8%B9%D9%82%D8%AF.pdf" }));
    assert.equal((await wt.signatureRequests.downloadPdfStream('sr_1')).filename, 'عقد.pdf');
    mock.push(new Response(PDF_BYTES, { status: 200 }));
    const bare = await wt.signatureRequests.downloadPdfStream('sr_1');
    assert.equal(bare.filename, null);
    assert.equal(bare.sha256, null);
  });
});

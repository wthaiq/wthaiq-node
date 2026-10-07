import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { InvalidArgumentError, UnexpectedResponseError, ValidationError, WthaiqError } from '../src/index.js';
import { apiError, json, makeClient, path, PDF_BYTES } from './helpers.js';

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

describe('document upload', () => {
  const docResponse = { id: 'doc_1', object: 'document', kind: 'pdf', filename: 'contract.pdf' };

  function parseMultipart(request: { headers: Record<string, string>; body: unknown }): {
    fields: Record<string, string>;
    file: { name: string; filename: string; type: string; content: Buffer } | null;
  } {
    const type = request.headers['Content-Type'] ?? '';
    const boundary = /boundary=(.+)$/.exec(type)?.[1];
    assert.ok(boundary, 'multipart boundary');
    assert.ok(request.body instanceof Uint8Array);
    const raw = Buffer.from(request.body).toString('latin1');
    assert.ok(raw.endsWith(`--${boundary}--\r\n`));
    const fields: Record<string, string> = {};
    let file = null;
    for (const part of raw.split(`--${boundary}`).slice(1, -1)) {
      const [head = '', ...rest] = part.slice(2).split('\r\n\r\n');
      const content = rest.join('\r\n\r\n').slice(0, -2);
      const name = /name="([^"]+)"/.exec(head)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      if (filename === undefined) fields[name] = Buffer.from(content, 'latin1').toString('utf8');
      else
        file = {
          name,
          filename,
          type: /Content-Type: (.+)/.exec(head)?.[1] ?? '',
          content: Buffer.from(content, 'latin1'),
        };
    }
    return { fields, file };
  }

  it('uploads a file path with kind and field map', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(201, docResponse));
    const file = join(dir, 'contract.pdf');
    writeFileSync(file, PDF_BYTES);
    const fieldMap = [
      { key: 'sig', type: 'signature' as const, page: 1, x: 10, y: 20, w: 100, h: 40, signer: 1 },
    ];
    const doc = await wt.documents.create(file, { kind: 'contract', field_map: fieldMap });
    assert.equal(doc.id, 'doc_1');
    assert.equal(mock.last.method, 'POST');
    assert.equal(path(mock.last), '/documents');
    assert.ok(mock.last.headers['Idempotency-Key']);
    const { fields, file: part } = parseMultipart(mock.last);
    assert.deepEqual(fields, { kind: 'contract', field_map: JSON.stringify(fieldMap) });
    assert.ok(part);
    assert.equal(part.name, 'file');
    assert.equal(part.filename, 'contract.pdf');
    assert.equal(part.type, 'application/pdf');
    assert.deepEqual(new Uint8Array(part.content), PDF_BYTES);
  });

  it('uploads bytes, ArrayBuffers, Blobs and { content, filename }', async () => {
    const { wt, mock } = makeClient();
    const inputs: [Parameters<typeof wt.documents.create>[0], string][] = [
      [Buffer.from(PDF_BYTES), 'document.pdf'],
      [PDF_BYTES.slice().buffer, 'document.pdf'],
      [new Blob([PDF_BYTES]), 'document.pdf'],
      [{ content: PDF_BYTES, filename: 'عقد "خاص".pdf' }, 'عقد \\"خاص\\".pdf'],
      [{ content: new Blob([PDF_BYTES]) }, 'document.pdf'],
      [{ content: new TextDecoder('latin1').decode(PDF_BYTES), filename: 'text.pdf' }, 'text.pdf'],
    ];
    for (const [input, expected] of inputs) {
      mock.push(json(201, docResponse));
      await wt.documents.create(input);
      const raw = Buffer.from(mock.last.body as Uint8Array).toString('utf8');
      assert.ok(raw.includes(`filename="${expected}"`), expected);
    }
    mock.push(json(201, docResponse));
    await wt.documents.create(PDF_BYTES, { filename: 'override.pdf', field_map: '[]' });
    const { fields, file } = parseMultipart(mock.last);
    assert.equal(file?.filename, 'override.pdf');
    assert.deepEqual(fields, { field_map: '[]' });
  });

  it('refuses invalid uploads before sending anything', async () => {
    const { wt, mock } = makeClient();
    const notPdf = new TextEncoder().encode('hello');
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set(PDF_BYTES);
    const cases: [() => Promise<unknown>, RegExp][] = [
      [() => wt.documents.create(notPdf), /must be a PDF/],
      [() => wt.documents.create(huge), /10 MB/],
      [() => wt.documents.create(join(dir, 'nope.pdf')), /does not exist/],
      [
        () => wt.documents.create(PDF_BYTES, { kind: 'pdf', title: 'x' } as never),
        /Unknown document parameter\(s\): title/,
      ],
      [() => wt.documents.create(PDF_BYTES, { filename: '' }), /filename/],
      [() => wt.documents.create(PDF_BYTES, { kind: 3 } as never), /kind/],
      [() => wt.documents.create(PDF_BYTES, { field_map: 5 } as never), /field_map/],
      [() => wt.documents.create(42 as never), /must be a path/],
    ];
    for (const [call, message] of cases) {
      await assert.rejects(
        call,
        (error: unknown) => error instanceof InvalidArgumentError && message.test(error.message),
      );
    }
    assert.equal(mock.requests.length, 0);
  });
});

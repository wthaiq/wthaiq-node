import { UnexpectedResponseError, WthaiqError } from '../core/errors.js';
import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import { attachResponse, ResponseMeta, type WthaiqResponse } from '../core/response.js';
import { buildPath, looksLikePdf, sha256Hex, timingSafeEqualHex, uuidV4 } from '../core/util.js';
import type {
  AuditEvent,
  BulkCreateParams,
  BulkSend,
  Certificate,
  Download,
  Evidence,
  PdfStream,
  Reminder,
  SignatureRequest,
  SignatureRequestCreateParams,
  SignatureRequestListParams,
} from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/** Result of {@link SignatureRequests.downloadPdfTo}. */
export interface SavedPdf {
  /** Where the file was written. */
  path: string;
  /** File size in bytes. */
  bytes: number;
  /** SHA-256 of the file (hex). */
  sha256: string;
}

/** Signature requests: create and send, follow, remind, cancel, and fetch the signed result. */
export class SignatureRequests extends ApiResource {
  /** Creates a signature request and sends it (or a draft with `send: false`). */
  async create(
    params: SignatureRequestCreateParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<SignatureRequest>> {
    return this.requestor.json<SignatureRequest>(
      'POST',
      '/signature_requests',
      paramsObject(params),
      options,
    );
  }

  /** Creates one signature request per recipient (plan feature `bulk`). */
  async createBulk(params: BulkCreateParams, options?: RequestOptions): Promise<WthaiqResponse<BulkSend>> {
    return this.requestor.json<BulkSend>('POST', '/signature_requests/bulk', paramsObject(params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<SignatureRequest>> {
    return this.requestor.json<SignatureRequest>(
      'GET',
      buildPath`/signature_requests/${id}`,
      undefined,
      options,
    );
  }

  /** One page of requests (`await`), or every request (`for await`). Newest first. */
  list(params?: SignatureRequestListParams, options?: RequestOptions): PagePromise<SignatureRequest> {
    return this.listPage<SignatureRequest>('/signature_requests', params, options);
  }

  /** Every request, fetched page by page. */
  all(params?: SignatureRequestListParams, options?: RequestOptions): AutoPager<SignatureRequest> {
    return this.autoPager<SignatureRequest>('/signature_requests', params, options);
  }

  /** Sends a draft. On a request already sent it acts as a resend (reminder limits apply). */
  async send(id: string, options?: RequestOptions): Promise<WthaiqResponse<SignatureRequest>> {
    return this.requestor.json<SignatureRequest>(
      'POST',
      buildPath`/signature_requests/${id}/send`,
      {},
      options,
    );
  }

  /** Reminds every signer who has not signed yet. */
  async remind(id: string, options?: RequestOptions): Promise<WthaiqResponse<Reminder>> {
    return this.requestor.json<Reminder>('POST', buildPath`/signature_requests/${id}/reminders`, {}, options);
  }

  /** Cancels the request; pending signing links stop working. Nothing is refunded. */
  async cancel(id: string, options?: RequestOptions): Promise<WthaiqResponse<SignatureRequest>> {
    return this.requestor.json<SignatureRequest>(
      'POST',
      buildPath`/signature_requests/${id}/cancel`,
      {},
      options,
    );
  }

  /** The audit trail of the request (one page of up to 200 events, oldest first). */
  listEvents(id: string, options?: RequestOptions): PagePromise<AuditEvent> {
    return this.listPage<AuditEvent>(() => buildPath`/signature_requests/${id}/events`, undefined, options);
  }

  /** The completion certificate (works at any status). */
  async certificate(id: string, options?: RequestOptions): Promise<WthaiqResponse<Certificate>> {
    return this.requestor.json<Certificate>(
      'GET',
      buildPath`/signature_requests/${id}/certificate`,
      undefined,
      options,
    );
  }

  /** Metadata of the final document (completed requests only). */
  async download(id: string, options?: RequestOptions): Promise<WthaiqResponse<Download>> {
    return this.requestor.json<Download>(
      'GET',
      buildPath`/signature_requests/${id}/download`,
      undefined,
      options,
    );
  }

  /**
   * The final PDF as a `Buffer`. The bytes are checked against the `X-File-Sha256` header.
   * A `409 pdf_not_ready` means the file is still being generated: retry later.
   */
  async downloadPdf(id: string, options?: RequestOptions): Promise<WthaiqResponse<Buffer>> {
    const raw = await this.requestor.bytes(
      buildPath`/signature_requests/${id}/download/pdf`,
      options,
      'application/pdf',
    );
    if (!looksLikePdf(raw.body)) {
      throw new UnexpectedResponseError('The Wthaiq API did not return a PDF file.', {
        statusCode: raw.statusCode,
        rawBody: new TextDecoder().decode(raw.body.subarray(0, 500)),
      });
    }
    const expected = raw.headers['x-file-sha256'];
    if (expected !== undefined && expected !== '') {
      const actual = await sha256Hex(raw.body);
      if (!timingSafeEqualHex(expected, actual)) {
        throw new UnexpectedResponseError(
          'The downloaded PDF does not match the X-File-Sha256 fingerprint sent by the API.',
          { statusCode: raw.statusCode },
        );
      }
    }
    return attachResponse(toBuffer(raw.body), new ResponseMeta(raw.statusCode, raw.headers));
  }

  /**
   * Downloads the final PDF, verifies it, and writes it to `path` atomically (a temporary file is renamed
   * into place, so a partial file is never left behind). Node.js only.
   */
  async downloadPdfTo(id: string, path: string, options?: RequestOptions): Promise<SavedPdf> {
    const pdf = await this.downloadPdf(id, options);
    const fs = await import('node:fs/promises');
    const tmp = `${path}.part-${(await uuidV4()).slice(0, 8)}`;
    try {
      await fs.writeFile(tmp, pdf, { flag: 'wx' });
      await fs.rename(tmp, path);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw new WthaiqError(
        `Could not write the PDF to "${path}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return { path, bytes: pdf.length, sha256: await sha256Hex(pdf) };
  }

  /**
   * The final PDF as a web `ReadableStream`, without buffering it. The bytes are not verified here: compare
   * `sha256` with the hash of what you stored.
   */
  async downloadPdfStream(id: string, options?: RequestOptions): Promise<WthaiqResponse<PdfStream>> {
    const raw = await this.requestor.stream(
      buildPath`/signature_requests/${id}/download/pdf`,
      options,
      'application/pdf',
    );
    if (raw.body === null) {
      throw new UnexpectedResponseError('The Wthaiq API returned an empty response instead of a PDF file.', {
        statusCode: raw.statusCode,
      });
    }
    const length = raw.headers['content-length'];
    const result: PdfStream = {
      body: raw.body,
      sha256: raw.headers['x-file-sha256'] ?? null,
      filename: filenameFromDisposition(raw.headers['content-disposition']),
      contentLength: length !== undefined && /^\d+$/.test(length) ? Number(length) : null,
    };
    return attachResponse(result, new ResponseMeta(raw.statusCode, raw.headers));
  }

  /** The evidence record: sealed for live requests, an unsealed test record in test mode. */
  async evidence(id: string, options?: RequestOptions): Promise<WthaiqResponse<Evidence>> {
    return this.requestor.json<Evidence>(
      'GET',
      buildPath`/signature_requests/${id}/evidence`,
      undefined,
      options,
    );
  }
}

function toBuffer(bytes: Uint8Array): Buffer {
  const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (BufferCtor !== undefined) return BufferCtor.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes as Buffer;
}

function filenameFromDisposition(header: string | undefined): string | null {
  if (header === undefined) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1] !== undefined) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
  const value = plain?.[1] ?? plain?.[2];
  return value === undefined ? null : value.trim();
}

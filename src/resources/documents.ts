import { InvalidArgumentError } from '../core/errors.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildMultipart, buildPath, looksLikePdf, utf8 } from '../core/util.js';
import type { Document, DocumentCreateParams } from '../types.js';
import { ApiResource, paramsObject } from './base.js';

const MAX_BYTES = 10 * 1024 * 1024;
const PARAM_KEYS = new Set(['kind', 'field_map', 'filename']);

/** Minimal `Blob` shape (also matches `File`). */
export interface BlobLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly name?: string;
}

/** Raw bytes with an optional file name. */
export interface FileContent {
  content: Uint8Array | ArrayBuffer | BlobLike | string;
  filename?: string;
}

/**
 * A PDF to upload: a file path (Node.js), bytes (`Buffer`, `Uint8Array`, `ArrayBuffer`), a `Blob`/`File`,
 * or `{ content, filename }`.
 */
export type FileInput = string | Uint8Array | ArrayBuffer | BlobLike | FileContent;

/** Uploaded PDF documents. */
export class Documents extends ApiResource {
  /** Uploads a PDF (at most 10 MB) with an optional field map. */
  async create(
    file: FileInput,
    params?: DocumentCreateParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<Document>> {
    const input = paramsObject(params);
    const unknown = Object.keys(input).filter((key) => !PARAM_KEYS.has(key));
    if (unknown.length > 0) {
      throw new InvalidArgumentError(`Unknown document parameter(s): ${unknown.join(', ')}.`);
    }
    const read = await readFile(file);
    const content = read.content;
    let filename = read.filename;
    if (content.length > MAX_BYTES)
      throw new InvalidArgumentError('The file is larger than the 10 MB limit.');
    if (!looksLikePdf(content)) throw new InvalidArgumentError('The file must be a PDF.');

    if (input['filename'] !== undefined) {
      if (typeof input['filename'] !== 'string' || input['filename'] === '') {
        throw new InvalidArgumentError('filename must be a non-empty string.');
      }
      filename = input['filename'];
    }
    const fields: Record<string, string> = {};
    if (input['kind'] !== undefined) {
      if (typeof input['kind'] !== 'string') throw new InvalidArgumentError('kind must be a string.');
      fields['kind'] = input['kind'];
    }
    if (input['field_map'] !== undefined) {
      const map = input['field_map'];
      if (Array.isArray(map)) fields['field_map'] = JSON.stringify(map);
      else if (typeof map === 'string') fields['field_map'] = map;
      else throw new InvalidArgumentError('field_map must be an array or a JSON string.');
    }
    const body = await buildMultipart(fields, {
      file: { filename, contentType: 'application/pdf', content },
    });
    return this.requestor.jsonWithBody<Document>(
      '/documents',
      { bytes: body.body, contentType: body.contentType },
      options,
    );
  }

  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<Document>> {
    return this.requestor.json<Document>('GET', buildPath`/documents/${id}`, undefined, options);
  }
}

async function readFile(file: FileInput): Promise<{ content: Uint8Array; filename: string }> {
  if (typeof file === 'string') {
    const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]);
    let data: Uint8Array;
    try {
      data = await fs.readFile(file);
    } catch (error) {
      throw new InvalidArgumentError(`The file "${file}" does not exist or is not readable.`, {
        cause: error,
      });
    }
    return {
      content: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      filename: path.basename(file),
    };
  }
  if (file instanceof Uint8Array) return { content: file, filename: 'document.pdf' };
  if (file instanceof ArrayBuffer) return { content: new Uint8Array(file), filename: 'document.pdf' };
  if (isBlobLike(file)) {
    const name = typeof file.name === 'string' && file.name !== '' ? file.name : 'document.pdf';
    return { content: new Uint8Array(await file.arrayBuffer()), filename: name };
  }
  if (typeof file === 'object' && file !== null && 'content' in file) {
    const name = typeof file.filename === 'string' && file.filename !== '' ? file.filename : undefined;
    const inner = file.content;
    if (typeof inner === 'string') return { content: utf8.encode(inner), filename: name ?? 'document.pdf' };
    const read = await readFile(inner);
    return { content: read.content, filename: name ?? read.filename };
  }
  throw new InvalidArgumentError(
    'The file must be a path, a Buffer/Uint8Array/ArrayBuffer, a Blob or File, or { content, filename }.',
  );
}

function isBlobLike(value: unknown): value is BlobLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    !('content' in value) &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

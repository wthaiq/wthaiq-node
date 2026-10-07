import { InvalidArgumentError } from './errors.js';
import { sha256, timingSafeEqualString, toHex } from './sha256.js';

/** @internal */
export const utf8 = new TextEncoder();

interface WebCryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
  subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}

function webCrypto(): WebCryptoLike | undefined {
  return (globalThis as { crypto?: WebCryptoLike }).crypto;
}

/** Random UUID v4, used for automatic idempotency keys. @internal */
export async function uuidV4(): Promise<string> {
  const crypto = webCrypto();
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  let bytes: Uint8Array;
  if (typeof crypto?.getRandomValues === 'function') {
    bytes = crypto.getRandomValues(new Uint8Array(16));
  } else {
    const nodeCrypto = await import('node:crypto');
    bytes = new Uint8Array(nodeCrypto.randomBytes(16));
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Hex SHA-256 of `bytes`, using Web Crypto when available. @internal */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = webCrypto()?.subtle;
  if (subtle !== undefined && typeof subtle.digest === 'function') {
    return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
  }
  return toHex(sha256(bytes));
}

/** Compares two hex digests case-insensitively in constant time. @internal */
export function timingSafeEqualHex(a: string, b: string): boolean {
  return timingSafeEqualString(a.trim().toLowerCase(), b.trim().toLowerCase());
}

/** Encodes GET parameters; `null`/`undefined` are skipped and booleans become `true`/`false`. @internal */
export function encodeQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(`${key}[]`, scalar(key, item));
    } else {
      search.append(key, scalar(key, value));
    }
  }
  return search.toString();
}

function scalar(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  throw new InvalidArgumentError(`The query parameter "${key}" must be a string, number, boolean or Date.`);
}

/** Encodes a POST body. An empty or missing body is sent as `{}`. @internal */
export function encodeJson(params: unknown): string {
  if (params === undefined || params === null) return '{}';
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new InvalidArgumentError('The request parameters must be a plain object.');
  }
  try {
    return JSON.stringify(params);
  } catch (error) {
    throw new InvalidArgumentError(
      `The request parameters cannot be encoded as JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Builds `/a/{id}/b` paths with URL-encoded, non-empty ids. @internal */
export function buildPath(strings: TemplateStringsArray, ...ids: unknown[]): string {
  let out = strings[0] ?? '';
  ids.forEach((id, i) => {
    if (typeof id === 'number' && Number.isFinite(id)) id = String(id);
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidArgumentError('The object id must be a non-empty string.');
    }
    out += encodeURIComponent(id) + (strings[i + 1] ?? '');
  });
  return out;
}

/** A file part for {@link buildMultipart}. @internal */
export interface MultipartFile {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/** Builds a `multipart/form-data` body as bytes, so any fetch implementation can send (and resend) it. @internal */
export async function buildMultipart(
  fields: Record<string, string>,
  files: Record<string, MultipartFile>,
): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----wthaiq${(await uuidV4()).replace(/-/g, '')}`;
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      utf8.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const [name, file] of Object.entries(files)) {
    parts.push(
      utf8.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"; filename="${quote(file.filename)}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      utf8.encode('\r\n'),
    );
  }
  parts.push(utf8.encode(`--${boundary}--\r\n`));
  return { body: concatBytes(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function quote(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, '');
}

/** @internal */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Returns true when `bytes` starts with `%PDF-`. @internal */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** `node/<version>` (or the closest runtime token). @internal */
export function runtimeToken(): string {
  const proc = (globalThis as { process?: { versions?: Record<string, string | undefined> } }).process;
  const versions = proc?.versions;
  if (versions?.['bun'] !== undefined) return `bun/${versions['bun']}`;
  if (versions?.['node'] !== undefined) return `node/${versions['node']}`;
  if ((globalThis as { Deno?: unknown }).Deno !== undefined) return 'deno';
  return 'runtime/unknown';
}

/** Sleeps for `ms` milliseconds. @internal */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

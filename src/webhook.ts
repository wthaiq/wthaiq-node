import { InvalidArgumentError, isRecord, SignatureVerificationError } from './core/errors.js';
import { hmacSha256, timingSafeEqualString, toHex } from './core/sha256.js';
import { concatBytes, utf8 } from './core/util.js';
import type { WthaiqEvent } from './types.js';

/** The raw request body exactly as received: a string, or the bytes (`Buffer`, `Uint8Array`). */
export type WebhookPayload = string | Uint8Array;

/** The `Wthaiq-Signature` header as frameworks expose it. */
export type WebhookSignatureHeader = string | readonly string[] | null | undefined;

export interface GenerateTestHeaderParams {
  payload: WebhookPayload;
  secret: string;
  /** Unix seconds; defaults to now. */
  timestamp?: number;
}

const DEFAULT_TOLERANCE = 300;

/**
 * Verifies webhook deliveries.
 *
 * The platform signs every delivery with the endpoint secret:
 * `Wthaiq-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>`.
 * Always verify against the raw body (before any JSON parsing), and dedupe on `event.id`.
 */
export class Webhook {
  static readonly SIGNATURE_HEADER = 'Wthaiq-Signature';
  static readonly EVENT_ID_HEADER = 'Wthaiq-Event-Id';
  static readonly ENDPOINT_ID_HEADER = 'Wthaiq-Endpoint-Id';
  static readonly DEFAULT_TOLERANCE = DEFAULT_TOLERANCE;

  /**
   * Verifies the signature and returns the decoded event.
   *
   * @param payload The raw request body (string or Buffer), not the parsed JSON.
   * @param header The `Wthaiq-Signature` header.
   * @param secret The endpoint secret (`whsec_…`) returned when the endpoint was created.
   * @param tolerance Maximum age of the signature in seconds (default 300; `0` disables the check).
   * @throws {SignatureVerificationError} when the header is missing or invalid, the signature does not
   *   match, the timestamp is outside the tolerance, or the payload is not a JSON object.
   */
  static constructEvent(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): WthaiqEvent {
    const headerText = Webhook.verifyHeader(payload, header, secret, tolerance);
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch (cause) {
      throw new SignatureVerificationError('The webhook payload is not valid JSON.', {
        header: headerText,
        cause,
      });
    }
    if (!isRecord(decoded)) {
      throw new SignatureVerificationError('The webhook payload is not a JSON object.', {
        header: headerText,
      });
    }
    return decoded as unknown as WthaiqEvent;
  }

  /**
   * Verifies the signature without decoding the payload. Returns the header string.
   *
   * @throws {SignatureVerificationError} see {@link Webhook.constructEvent}.
   */
  static verifyHeader(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): string {
    const bytes = payloadBytes(payload);
    if (typeof secret !== 'string' || secret === '') {
      throw new InvalidArgumentError(
        'The webhook endpoint secret is empty. Use the whsec_... value returned when the endpoint was created.',
      );
    }
    if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
      throw new InvalidArgumentError('tolerance must be a non-negative number of seconds.');
    }
    const headerText = headerString(header);
    if (headerText === '') {
      throw new SignatureVerificationError('The Wthaiq-Signature header is missing.', { header: headerText });
    }
    const { timestamp, signatures } = parseHeader(headerText);
    if (timestamp === null) {
      throw new SignatureVerificationError('Unable to read the timestamp from the Wthaiq-Signature header.', {
        header: headerText,
      });
    }
    if (signatures.length === 0) {
      throw new SignatureVerificationError('No v1 signature found in the Wthaiq-Signature header.', {
        header: headerText,
      });
    }
    const expected = signBytes(timestamp, bytes, secret);
    let match = false;
    for (const signature of signatures) {
      if (timingSafeEqualString(expected, signature.toLowerCase())) match = true;
    }
    if (!match) {
      throw new SignatureVerificationError(
        'The webhook signature does not match the payload. Check that you use the raw request body and the right endpoint secret.',
        { header: headerText },
      );
    }
    if (tolerance > 0 && Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > tolerance) {
      throw new SignatureVerificationError(
        `The webhook timestamp is outside the tolerance of ${tolerance} seconds.`,
        {
          header: headerText,
        },
      );
    }
    return headerText;
  }

  /** Returns true when the signature is valid (never throws for a bad signature). */
  static isValid(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): boolean {
    try {
      Webhook.verifyHeader(payload, header, secret, tolerance);
      return true;
    } catch (error) {
      if (error instanceof SignatureVerificationError) return false;
      throw error;
    }
  }

  /** `hex(HMAC_SHA256(secret, timestamp + "." + payload))`, exactly as the platform computes it. */
  static computeSignature(timestamp: number | string, payload: WebhookPayload, secret: string): string {
    return signBytes(String(timestamp), payloadBytes(payload), secret);
  }

  /** Builds a valid `Wthaiq-Signature` header, for testing your own webhook handler. */
  static generateTestHeader(params: GenerateTestHeaderParams): string {
    const t = String(params.timestamp ?? Math.floor(Date.now() / 1000));
    return `t=${t},v1=${Webhook.computeSignature(t, params.payload, params.secret)}`;
  }
}

/** The same helpers bound to a client instance: `wt.webhooks.constructEvent(...)`. */
export class Webhooks {
  constructEvent(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): WthaiqEvent {
    return Webhook.constructEvent(payload, header, secret, tolerance);
  }

  verifyHeader(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): string {
    return Webhook.verifyHeader(payload, header, secret, tolerance);
  }

  isValid(
    payload: WebhookPayload,
    header: WebhookSignatureHeader,
    secret: string,
    tolerance: number = DEFAULT_TOLERANCE,
  ): boolean {
    return Webhook.isValid(payload, header, secret, tolerance);
  }

  computeSignature(timestamp: number | string, payload: WebhookPayload, secret: string): string {
    return Webhook.computeSignature(timestamp, payload, secret);
  }

  generateTestHeader(params: GenerateTestHeaderParams): string {
    return Webhook.generateTestHeader(params);
  }
}

function signBytes(timestamp: string, payload: Uint8Array, secret: string): string {
  const message = concatBytes([utf8.encode(`${timestamp}.`), payload]);
  return toHex(hmacSha256(utf8.encode(secret), message));
}

function payloadBytes(payload: unknown): Uint8Array {
  if (typeof payload === 'string') return utf8.encode(payload);
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  throw new InvalidArgumentError(
    'The webhook payload must be the raw request body as a string or Buffer. In Express use ' +
      "express.raw({ type: 'application/json' }); in Next.js use await request.text().",
  );
}

function headerString(header: WebhookSignatureHeader): string {
  if (typeof header === 'string') return header.trim();
  if (Array.isArray(header)) return header.join(',').trim();
  return '';
}

function parseHeader(header: string): { timestamp: string | null; signatures: string[] } {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = value;
    else if (key === 'v1' && value !== '') signatures.push(value);
  }
  return { timestamp, signatures };
}

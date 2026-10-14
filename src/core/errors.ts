import { MAX_SIGNERS, PLANS_URL, VERIFY_URL } from '../version.js';

/**
 * Base class of every error thrown by this library. Catch it to handle any failure from the SDK.
 */
export class WthaiqError extends Error {
  override name = 'WthaiqError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
  }
}

/** The library was used incorrectly (bad option, missing id, unreadable file). No request was sent. */
export class InvalidArgumentError extends WthaiqError {
  override name = 'InvalidArgumentError';
}

/** The API could not be reached: DNS, TLS, connection reset, timeout or an aborted request. */
export class ApiConnectionError extends WthaiqError {
  override name = 'ApiConnectionError';
  /** True when the request was stopped because it exceeded the configured timeout. */
  readonly timedOut: boolean;
  /** True when the request was stopped by the caller's `AbortSignal`. */
  readonly aborted: boolean;

  constructor(message: string, options: { cause?: unknown; timedOut?: boolean; aborted?: boolean } = {}) {
    super(message, options);
    this.timedOut = options.timedOut ?? false;
    this.aborted = options.aborted ?? false;
  }
}

/** The API answered with a body this library cannot use (not JSON, not a PDF, fingerprint mismatch). */
export class UnexpectedResponseError extends WthaiqError {
  override name = 'UnexpectedResponseError';
  readonly statusCode: number | null;
  readonly rawBody: string;

  constructor(
    message: string,
    options: { statusCode?: number | null; rawBody?: string; cause?: unknown } = {},
  ) {
    super(message, options);
    this.statusCode = options.statusCode ?? null;
    this.rawBody = options.rawBody ?? '';
  }
}

/** A webhook signature header is missing, malformed, does not match the payload, or is too old. */
export class SignatureVerificationError extends WthaiqError {
  override name = 'SignatureVerificationError';
  /** The `Wthaiq-Signature` header that failed verification. */
  readonly header: string;

  constructor(message: string, options: { header?: string; cause?: unknown } = {}) {
    super(message, options);
    this.header = options.header ?? '';
  }
}

/** Fields used to build an {@link ApiError}. */
export interface ApiErrorInit {
  statusCode: number;
  type?: string | null;
  code?: string | null;
  param?: string | null;
  requestId?: string | null;
  error?: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string>;
  cause?: unknown;
}

/**
 * The API answered with an HTTP error. Branch on `code` (machine readable), never on `message`
 * (human text: Arabic by default, English with the client option `language: 'en'`).
 */
export class ApiError extends WthaiqError {
  override name = 'ApiError';
  /** HTTP status code. */
  readonly statusCode: number;
  /** Error type, e.g. `invalid_request_error`, `permission_error`, `rate_limit_error`. */
  readonly type: string | null;
  /** Machine code, e.g. `parameter_missing`, `plan_feature_unavailable`, `too_many_requests`. */
  readonly code: string | null;
  /** The request field the error refers to, e.g. `signers[0].email`. */
  readonly param: string | null;
  /** Request id (`req_…`) to quote to support. */
  readonly requestId: string | null;
  /** The decoded `error` object of the response body, including fields not modelled here. */
  readonly error: Readonly<Record<string, unknown>>;
  /** The raw response body. */
  readonly rawBody: string;
  /** Response headers with lower-case names. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(message: string, init: ApiErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.statusCode = init.statusCode;
    this.type = init.type ?? null;
    this.code = init.code ?? null;
    this.param = init.param ?? null;
    this.requestId = init.requestId ?? null;
    this.error = init.error ?? {};
    this.rawBody = init.rawBody ?? '';
    this.headers = init.headers ?? {};
  }

  /** Returns a response header (case-insensitive) or null. */
  getHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }
}

/** 400 / 405 / 409 and other client errors. */
export class InvalidRequestError extends ApiError {
  override name = 'InvalidRequestError';
}

/** 400: a parameter is missing or invalid. `param` names the field. */
export class ValidationError extends InvalidRequestError {
  override name = 'ValidationError';

  /** `{ [param]: message }`, or `{}` when the error is not tied to one field. */
  get fieldErrors(): Record<string, string> {
    return this.param === null ? {} : { [this.param]: this.message };
  }
}

/**
 * 400 `too_many_signers`: a live signature request has more signers than allowed. Every signer of a live
 * request counts as one send from the plan quota; split the signers over several requests.
 */
export class TooManySignersError extends ValidationError {
  override name = 'TooManySignersError';

  /** Most signers allowed in one request, from the error body (`max_signers`), else {@link MAX_SIGNERS}. */
  get maxSigners(): number {
    const value = this.error['max_signers'];
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : MAX_SIGNERS;
  }
}

/** 404: the object does not exist, belongs to another account, or is in the other mode (test vs live). */
export class NotFoundError extends InvalidRequestError {
  override name = 'NotFoundError';
}

/**
 * 409: idempotency conflicts (`idempotency_key_reused`, `idempotency_in_progress`) and state conflicts
 * (`request_not_cancelable`, `pdf_not_ready`, `pdf_unavailable`, `workflow_not_live`).
 */
export class ConflictError extends InvalidRequestError {
  override name = 'ConflictError';
}

/** 401: the API key is missing, malformed, revoked, or the account is inactive. */
export class AuthenticationError extends ApiError {
  override name = 'AuthenticationError';
}

/**
 * 403: the key cannot do this (`forbidden` for read-only or publishable keys), the plan lacks a feature
 * (`plan_feature_unavailable`), the company is not verified (`kyb_required`), or the IP is not allowed.
 */
export class PermissionError extends ApiError {
  override name = 'PermissionError';

  /** The missing plan capability (with `plan_feature_unavailable`), e.g. `bulk`, `embed`, `ordered`. */
  get feature(): string | null {
    return stringField(this.error, 'feature');
  }

  /** The cheapest plan that includes the feature, e.g. `ap_biz`. */
  get requiredPlan(): string | null {
    return stringField(this.error, 'required_plan');
  }

  /**
   * Where to upgrade the plan (`upgrade_url`). For `kyb_required` it returns {@link verifyUrl}, so that a
   * single property always points to the page that unblocks the call.
   */
  get upgradeUrl(): string | null {
    const url = stringField(this.error, 'upgrade_url');
    if (url !== null) return url;
    if (this.isKybRequired()) return this.verifyUrl;
    return this.isPlanFeatureUnavailable() ? PLANS_URL : null;
  }

  /** Where to verify the company (`verify_url`, with `kyb_required`), or null for other codes. */
  get verifyUrl(): string | null {
    const url = stringField(this.error, 'verify_url');
    if (url !== null) return url;
    return this.isKybRequired() ? VERIFY_URL : null;
  }

  isPlanFeatureUnavailable(): boolean {
    return this.code === 'plan_feature_unavailable';
  }

  isKybRequired(): boolean {
    return this.code === 'kyb_required';
  }
}

/** 402: no paid plan (`plan_required`), plan expired (`plan_expired`) or wallet too low (`insufficient_balance`). */
export class PaymentRequiredError extends ApiError {
  override name = 'PaymentRequiredError';

  /** Where to buy, renew or upgrade the plan (`upgrade_url`), else {@link PLANS_URL}. */
  get upgradeUrl(): string {
    return stringField(this.error, 'upgrade_url') ?? PLANS_URL;
  }

  isPlanRequired(): boolean {
    return this.code === 'plan_required';
  }

  isPlanExpired(): boolean {
    return this.code === 'plan_expired';
  }

  isInsufficientBalance(): boolean {
    return this.code === 'insufficient_balance';
  }
}

/**
 * 429: too many requests. Only `too_many_requests` is transient (retried automatically); quota codes
 * such as `daily_cap_reached`, `reminder_too_soon` or `test_daily_limit` are not.
 */
export class RateLimitError extends ApiError {
  override name = 'RateLimitError';

  /** Seconds to wait, from the `Retry-After` header, or null. */
  get retryAfter(): number | null {
    const value = this.getHeader('retry-after');
    if (value === null || !/^\d+$/.test(value.trim())) return null;
    return Number(value.trim());
  }

  isTransient(): boolean {
    return this.code === null || this.code === 'too_many_requests';
  }
}

/** 5xx: the API failed (`internal_error`, `delivery_failed`, `feature_unavailable`, `not_implemented`). */
export class ServerError extends ApiError {
  override name = 'ServerError';
}

function stringField(source: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Decodes the `error` object of an error response body, or `{}`. @internal */
export function parseErrorBody(body: string): Record<string, unknown> {
  if (body === '') return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return {};
  }
  if (!isRecord(decoded) || !isRecord(decoded['error'])) return {};
  return { ...decoded['error'] };
}

/** Builds the typed error for an HTTP error response. @internal */
export function errorFromResponse(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): ApiError {
  const error = parseErrorBody(body);
  const str = (key: string): string | null => {
    const value = error[key];
    if (typeof value === 'string') return value === '' ? null : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  };
  let message = str('message');
  if (message === null) {
    const snippet = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    message = `The Wthaiq API returned HTTP ${statusCode}${snippet !== '' ? `: ${snippet}` : '.'}`;
  }
  const init: ApiErrorInit = {
    statusCode,
    type: str('type'),
    code: str('code'),
    param: str('param'),
    requestId: str('request_id') ?? headers['wthaiq-request-id'] ?? null,
    error,
    rawBody: body,
    headers,
  };
  const ErrorClass = errorClassFor(statusCode, init.code ?? null);
  return new ErrorClass(message, init);
}

function errorClassFor(
  status: number,
  code: string | null,
): new (message: string, init: ApiErrorInit) => ApiError {
  switch (status) {
    case 400:
      return code === 'too_many_signers' ? TooManySignersError : ValidationError;
    case 401:
      return AuthenticationError;
    case 402:
      return PaymentRequiredError;
    case 403:
      return PermissionError;
    case 404:
      return NotFoundError;
    case 409:
      return ConflictError;
    case 429:
      return RateLimitError;
    default:
      if (status >= 500) return ServerError;
      if (status >= 400) return InvalidRequestError;
      return ApiError;
  }
}

/** @internal */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every error class of the library, also reachable as `Wthaiq.errors`. */
export const errors = {
  WthaiqError,
  InvalidArgumentError,
  ApiConnectionError,
  UnexpectedResponseError,
  SignatureVerificationError,
  ApiError,
  InvalidRequestError,
  ValidationError,
  TooManySignersError,
  NotFoundError,
  ConflictError,
  AuthenticationError,
  PermissionError,
  PaymentRequiredError,
  RateLimitError,
  ServerError,
} as const;

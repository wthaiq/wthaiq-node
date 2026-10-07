import { errors, InvalidArgumentError } from './core/errors.js';
import { Requestor, validateApiKey, type FetchLike } from './core/requestor.js';
import { RetryPolicy, type RetryPolicyOptions } from './core/retry.js';
import { runtimeToken } from './core/util.js';
import { AccountResource, BalanceResource, UsageResource } from './resources/account.js';
import { Documents } from './resources/documents.js';
import { Events } from './resources/events.js';
import { Flows } from './resources/flows.js';
import { IdentityVerifications } from './resources/identity-verifications.js';
import { Sessions } from './resources/sessions.js';
import { SignatureRequests } from './resources/signature-requests.js';
import { Signers } from './resources/signers.js';
import { Templates } from './resources/templates.js';
import { Verifications } from './resources/verifications.js';
import { WebhookEndpoints } from './resources/webhook-endpoints.js';
import { API_VERSION, DEFAULT_BASE_URL, VERSION } from './version.js';
import { Webhook, Webhooks } from './webhook.js';

/** Identifies your integration in the `User-Agent` header. */
export interface AppInfo {
  name: string;
  version?: string;
  url?: string;
}

/** Client settings. */
export interface ClientOptions {
  /** API base URL. Default `https://wthaiq.com/api/v1`. */
  baseUrl?: string;
  /** Time allowed for each attempt, in milliseconds. Default 60000. */
  timeout?: number;
  /** Automatic retries of transient failures. Default 2 (3 attempts in total). */
  maxRetries?: number;
  /** Sent as `Wthaiq-Version`. Default `2026-07-01`. */
  apiVersion?: string;
  /** Appended to the `User-Agent` header. */
  appInfo?: AppInfo;
  /** A `fetch` implementation (for proxies, logging or tests). Default: the global `fetch`. */
  fetch?: FetchLike;
  /** Backoff settings, or a configured {@link RetryPolicy}. */
  retryPolicy?: RetryPolicy | RetryPolicyOptions;
}

/** Client settings including the API key, for `new Wthaiq({ apiKey, ... })`. */
export interface ClientConfig extends ClientOptions {
  /** Secret key (`sk_…` or `sk_test_…`). Publishable keys (`pk_…`) work only on the routes they allow. */
  apiKey: string;
}

const OPTION_KEYS = new Set([
  'apiKey',
  'baseUrl',
  'timeout',
  'maxRetries',
  'apiVersion',
  'appInfo',
  'fetch',
  'retryPolicy',
]);

/**
 * The Wthaiq API client.
 *
 * ```ts
 * import Wthaiq from 'wthaiq';
 * const wt = new Wthaiq(process.env.WTHAIQ_API_KEY!);
 * const sr = await wt.signatureRequests.create({ ... });
 * ```
 */
export class Wthaiq {
  /** Version of this library. */
  static readonly VERSION = VERSION;
  /** API version this release targets. */
  static readonly API_VERSION = API_VERSION;
  /** Default API base URL. */
  static readonly DEFAULT_BASE_URL = DEFAULT_BASE_URL;
  /** Webhook signature helpers (static). */
  static readonly Webhook = Webhook;
  /** Every error class, e.g. `Wthaiq.errors.RateLimitError`. */
  static readonly errors = errors;

  /** `GET /` */
  readonly account: AccountResource;
  /** `GET /usage` */
  readonly usage: UsageResource;
  /** `GET /balance` */
  readonly balance: BalanceResource;
  readonly templates: Templates;
  readonly signatureRequests: SignatureRequests;
  readonly sessions: Sessions;
  readonly signers: Signers;
  readonly documents: Documents;
  readonly identityVerifications: IdentityVerifications;
  readonly verifications: Verifications;
  readonly webhookEndpoints: WebhookEndpoints;
  readonly events: Events;
  readonly flows: Flows;
  /** Webhook signature helpers: `wt.webhooks.constructEvent(rawBody, header, secret)`. */
  readonly webhooks: Webhooks;

  readonly #apiKey: string;
  readonly #baseUrl: string;

  constructor(apiKey: string, options?: ClientOptions);
  constructor(config: ClientConfig);
  constructor(apiKeyOrConfig: string | ClientConfig, options: ClientOptions = {}) {
    const config: Record<string, unknown> =
      typeof apiKeyOrConfig === 'object' && apiKeyOrConfig !== null
        ? { ...options, ...apiKeyOrConfig }
        : { ...options, apiKey: apiKeyOrConfig };
    const unknown = Object.keys(config).filter((key) => !OPTION_KEYS.has(key));
    if (unknown.length > 0) {
      throw new InvalidArgumentError(
        `Unknown client option(s): ${unknown.join(', ')}. Allowed: ${[...OPTION_KEYS].join(', ')}.`,
      );
    }

    this.#apiKey = validateApiKey(config['apiKey']);
    this.#baseUrl = validateBaseUrl(config['baseUrl'] ?? DEFAULT_BASE_URL);
    const timeout = config['timeout'] ?? 60_000;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      throw new InvalidArgumentError('timeout must be a positive number of milliseconds.');
    }
    const maxRetries = config['maxRetries'] ?? 2;
    if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new InvalidArgumentError('maxRetries must be a non-negative integer.');
    }
    const apiVersion = config['apiVersion'] ?? API_VERSION;
    if (typeof apiVersion !== 'string' || apiVersion === '') {
      throw new InvalidArgumentError('apiVersion must be a non-empty string.');
    }
    const fetchFn = config['fetch'];
    if (fetchFn !== undefined && typeof fetchFn !== 'function') {
      throw new InvalidArgumentError('fetch must be a function compatible with the global fetch.');
    }
    const retry = config['retryPolicy'];
    let retryPolicy: RetryPolicy;
    if (retry === undefined) retryPolicy = new RetryPolicy();
    else if (retry instanceof RetryPolicy) retryPolicy = retry;
    else if (typeof retry === 'object' && retry !== null) retryPolicy = new RetryPolicy(retry);
    else throw new InvalidArgumentError('retryPolicy must be a RetryPolicy or an options object.');

    const requestor = new Requestor({
      apiKey: this.#apiKey,
      baseUrl: this.#baseUrl,
      timeout,
      maxRetries,
      apiVersion,
      userAgent: userAgent(config['appInfo']),
      fetch: fetchFn as FetchLike | undefined,
      retryPolicy,
    });

    this.account = new AccountResource(requestor);
    this.usage = new UsageResource(requestor);
    this.balance = new BalanceResource(requestor);
    this.templates = new Templates(requestor);
    this.signatureRequests = new SignatureRequests(requestor);
    this.sessions = new Sessions(requestor);
    this.signers = new Signers(requestor);
    this.documents = new Documents(requestor);
    this.identityVerifications = new IdentityVerifications(requestor);
    this.verifications = new Verifications(requestor);
    this.webhookEndpoints = new WebhookEndpoints(requestor);
    this.events = new Events(requestor);
    this.flows = new Flows(requestor);
    this.webhooks = new Webhooks();
  }

  /** True for test keys (`sk_test_…`, `pk_test_…`): free, nothing is really sent, no legal effect. */
  isTestMode(): boolean {
    return this.#apiKey.startsWith('sk_test_') || this.#apiKey.startsWith('pk_test_');
  }

  /** True for live keys (`sk_…`, `pk_…`): requests are sent and billed. */
  isLiveMode(): boolean {
    return !this.isTestMode();
  }

  /** True for publishable keys (`pk_…`), which only work on a few routes. */
  isPublishableKey(): boolean {
    return this.#apiKey.startsWith('pk_');
  }

  /** The API base URL in use. */
  getBaseUrl(): string {
    return this.#baseUrl;
  }
}

function validateBaseUrl(url: unknown): string {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url)) {
    throw new InvalidArgumentError(
      'baseUrl must be an absolute http(s) URL such as https://wthaiq.com/api/v1.',
    );
  }
  return url.replace(/\/+$/, '');
}

function userAgent(appInfo: unknown): string {
  const ua = `wthaiq-node/${VERSION} ${runtimeToken()}`;
  if (appInfo === undefined || appInfo === null) return ua;
  if (
    typeof appInfo !== 'object' ||
    typeof (appInfo as AppInfo).name !== 'string' ||
    (appInfo as AppInfo).name === ''
  ) {
    throw new InvalidArgumentError('appInfo must be an object with a non-empty name.');
  }
  const info = appInfo as AppInfo;
  let part = info.name.replace(/[^A-Za-z0-9._-]+/g, '-');
  if (typeof info.version === 'string' && info.version !== '') {
    part += `/${info.version.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
  }
  if (typeof info.url === 'string' && info.url !== '') {
    part += ` (${info.url.replace(/[\s()]+/g, '')})`;
  }
  return `${ua} ${part}`;
}

/**
 * Request and response shapes of the Wthaiq API (version 2026-07-01). Field names are the API's own
 * (`snake_case`). Timestamps are Unix seconds unless documented otherwise.
 */

import type { EventType } from './event-types.js';

/** Free-form JSON object. */
export type JsonObject = Record<string, unknown>;

/** An amount with its integer minor-unit value (piastres or cents). */
export interface Money {
  amount: number;
  amount_minor: number;
  currency: Currency;
}

export type Currency = 'EGP' | 'USD';
export type PlanId = 'ap_trial' | 'ap_dev' | 'ap_biz' | 'ap_ent' | 'ap_custom';
export type LegalLevel = 'ses' | 'aes' | 'qes';
export type PadesFormat = 'pades-b' | 'pades-t' | 'pades-lt' | 'pades-lta';
export type Channel = 'email' | 'whatsapp' | 'link';
export type Language = 'ar' | 'en';
export type SignerType = 'individual' | 'company';
export type SignMethod = 'draw' | 'token';
export type FieldType = 'text' | 'number' | 'date' | 'email' | 'tel' | 'signature';

// ---------------------------------------------------------------------------------------------------------
// Account

/** `GET /` */
export interface Account {
  object: 'api_root';
  name: string;
  version: string;
  livemode: boolean;
  base_url: string;
  account: { id: string; name: string; email?: string };
  plan: { id: PlanId; paid: boolean; sends_left: number };
  pricing: { overage_per_request: number; identity_per_signer: number; currency: Currency };
  docs: string;
}

export interface UsagePlan {
  id: PlanId;
  name: string;
  paid: boolean;
  period_start: number | null;
  period_end: number | null;
  sends_quota: number;
  sends_used: number;
  sends_left: number;
  auto_renew: boolean;
}

/** `GET /balance` */
export interface Balance {
  object: 'balance';
  livemode: boolean;
  balance: Money;
  month_spent: Money;
  plan: UsagePlan;
}

/** `GET /usage` */
export interface Usage extends Omit<Balance, 'object'> {
  object: 'usage';
  pricing: {
    overage_per_request: Money;
    identity_per_signer: Money;
    min_topup: Money;
    currency: Currency;
  };
  signature_requests: { total: number; last_30_days: number; completed: number };
}

// ---------------------------------------------------------------------------------------------------------
// Templates

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType | (string & {});
  required: boolean;
  /** Present on fields extracted from `{{key}}` placeholders only. */
  type_declared?: boolean;
  vtype?: string;
}

export interface Template {
  id: string;
  object: 'template';
  name: string;
  category: string | null;
  languages: string[];
  fields: TemplateField[];
  created_at: number;
  /** Only with `include: 'content'` on your own templates. */
  content?: string;
}

export interface TemplateFieldInput {
  key: string;
  label?: string;
  type?: FieldType | (string & {});
  required?: boolean;
}

export interface TemplateCreateParams {
  name: string;
  /** HTML with `{{key}}` placeholders. */
  content: string;
  fields?: TemplateFieldInput[];
}

export interface ListParams {
  /** 1–100, default 20. */
  limit?: number;
  /** The `next_cursor` of the previous page. */
  starting_after?: string;
}

export interface TemplateListParams extends ListParams {
  /** `mine` (or `own`) lists your own templates; otherwise the public catalogue. */
  scope?: 'mine' | 'own' | (string & {});
  owner?: 'me';
  search?: string;
}

export interface TemplateRetrieveParams {
  include?: 'content';
  scope?: 'mine' | 'own' | (string & {});
}

// ---------------------------------------------------------------------------------------------------------
// Signers and signature requests

export type SignerStatus =
  'pending' | 'sent' | 'viewed' | 'otp_verified' | 'identity_verified' | 'signed' | 'declined';

export type IdentityStatus =
  'none' | 'required' | 'in_review' | 'resubmission_requested' | 'declined' | 'approved';

export type IdentityReasonCode =
  | 'reviewer_decision'
  | 'document_expired'
  | 'document_not_original'
  | 'document_not_supported'
  | 'document_unreadable'
  | 'face_mismatch'
  | 'face_unclear'
  | 'not_accepted';

export interface SignerIdentity {
  status: IdentityStatus | (string & {});
  provider: string;
  level: LegalLevel | (string & {});
  verification_id: string | null;
  reason_code: IdentityReasonCode | (string & {}) | null;
  updated_at: number | null;
  resubmit_steps?: string[];
}

export interface Signer {
  id: string;
  object: 'signer';
  name: string;
  email: string | null;
  /** E.164 digits without `+`, e.g. `201012345678`. */
  phone: string | null;
  type: SignerType;
  method: SignMethod;
  require_identity: boolean;
  order: number;
  status: SignerStatus | (string & {});
  /** Null while the request is a draft. */
  signing_url: string | null;
  viewed_at: number | null;
  signed_at: number | null;
  fields: Record<string, unknown>;
  /** Only when `require_identity` is true. */
  identity?: SignerIdentity;
}

/** A signer inside a `signer.*` webhook event, with its request context. */
export interface SignerEventObject extends Signer {
  signature_request: string;
  workflow_id?: string;
  workflow_version?: number | null;
  vendor_data?: string;
}

export type SignatureRequestStatus =
  'draft' | 'sent' | 'partially_signed' | 'completed' | 'declined' | 'expired' | 'canceled';

export type SignatureRequestSource =
  { type: 'template'; template_id: string } | { type: 'document'; document_id: string };

export interface CcRecipient {
  name: string;
  email: string;
}

export interface Reminders {
  enabled: boolean;
  interval_hours?: number;
  max?: number;
}

export interface SignatureRequest {
  id: string;
  object: 'signature_request';
  livemode: boolean;
  status: SignatureRequestStatus | (string & {});
  title: string;
  legal_level: LegalLevel;
  format: PadesFormat;
  source: SignatureRequestSource;
  signers: Signer[];
  ordered: boolean;
  require_identity: boolean;
  /** Verification reference (`WTQ-…`), set when completed. */
  reference: string | null;
  cc: CcRecipient[];
  reminders: Reminders;
  metadata: JsonObject;
  expires_at: number | null;
  completed_at: number | null;
  download_url: string | null;
  created_at: number;
  /** Present on requests created through sessions/workflows. */
  workflow_id?: string;
  workflow_version?: number | null;
  vendor_data?: string;
  channel?: Channel;
  return_url?: string;
  trial?: boolean;
}

export interface SignerInput {
  name: string;
  email?: string;
  /** WhatsApp number in international format, e.g. `201012345678`. */
  phone?: string;
  type?: SignerType;
  method?: SignMethod;
  require_identity?: boolean;
  fields?: Record<string, unknown>;
}

export interface SignatureRequestCreateParams {
  source: SignatureRequestSource;
  signers: SignerInput[];
  title?: string;
  legal_level?: LegalLevel;
  require_identity?: boolean;
  format?: PadesFormat;
  ordered?: boolean;
  /** Default true. `false` creates a draft; send it later with `send()`. */
  send?: boolean;
  fields?: Record<string, unknown>;
  cc?: (string | { name?: string; email: string })[];
  reminders?: Reminders | boolean;
  metadata?: JsonObject;
}

export interface BulkCreateParams extends Omit<SignatureRequestCreateParams, 'signers'> {
  /** 1–200 recipients; one request is created for each. */
  recipients: SignerInput[];
}

export interface BulkSend {
  object: 'bulk_send';
  created: number;
  failed: number;
  requests: {
    signature_request: string;
    email: string | null;
    phone: string | null;
    status: SignatureRequestStatus | (string & {});
  }[];
  errors: { email: string | null; phone: string | null; error: string; code: string }[];
}

export interface SignatureRequestListParams extends ListParams {
  status?: SignatureRequestStatus;
  /** Unix timestamp, ISO date string or Date. */
  created_after?: number | string | Date;
  created_before?: number | string | Date;
}

export interface Reminder {
  object: 'reminder';
  signature_request: string;
  reminders_sent: number;
}

/** An entry of the audit trail (`GET /signature_requests/{id}/events`). */
export interface AuditEvent {
  id: string;
  object: 'event';
  /** `audit.` + the platform event, e.g. `audit.created`, `audit.signed`. */
  type: string;
  actor: string;
  ip: string | null;
  signature_request: string;
  created_at: number;
  /** Only for `audit.whatsapp_simulated` (test mode). */
  to?: string;
  description?: string;
}

/** Fields present on test-mode documents only. */
export interface TestModeMarkers {
  test?: boolean;
  legal_effect?: 'none' | (string & {});
  watermark?: string;
}

export interface Certificate extends TestModeMarkers {
  object: 'certificate';
  signature_request: string;
  status: SignatureRequestStatus | (string & {});
  reference: string | null;
  legal_level: LegalLevel;
  format: PadesFormat;
  completed_at: number | null;
  signers: {
    name: string;
    email: string | null;
    phone: string | null;
    status: SignerStatus | (string & {});
    signed_at: number | null;
  }[];
  audit_trail: { event: string; actor: string; ip: string | null; at: number }[];
  verify_url: string | null;
}

export interface Download extends TestModeMarkers {
  object: 'download';
  signature_request: string;
  /** Null when `pdf_status` is `unavailable` (use `final_document_url`). */
  pdf_url: string | null;
  pdf_status: 'ready' | 'pending' | 'unavailable';
  pdf_sha256: string | null;
  pdf_bytes: number | null;
  pdf_generated_at: number | null;
  final_document_url: string | null;
  reference: string | null;
  format: PadesFormat;
  legal_level: LegalLevel;
}

export interface EvidenceSeal {
  signature_alg: 'ed25519' | (string & {});
  /** Base64 Ed25519 signature over the exact bytes of `record_raw`. */
  signature: string;
  public_key: string;
  key_id: string;
  trust_url: string;
  /** Base64 RFC 3161 timestamp token. */
  timestamp_token: string | null;
  timestamp_gentime: string | null;
}

/**
 * The evidence record. Live requests return a sealed `wthaiq-evidence-v1` record; test mode returns an
 * unsealed `wthaiq-evidence-test-v1` record with `seal: null`. Note that `issued_at` is an ISO-8601 string.
 */
export interface Evidence extends TestModeMarkers {
  object: 'evidence';
  signature_request: string;
  format: 'wthaiq-evidence-v1' | 'wthaiq-evidence-test-v1' | (string & {});
  issued_at: string;
  record: JsonObject;
  seal: EvidenceSeal | null;
  /** Live: the exact JSON string that was sealed. */
  record_raw?: string;
  verify_ref?: string;
  platform_verification?: {
    signature_ok: boolean;
    timestamp_ok: boolean;
    level: string;
    independent_layers: number;
    checked_at: string;
  };
  how_to_verify?: string;
  /** Test mode only. */
  livemode?: boolean;
  notice?: string;
}

/** The final PDF as a stream (see `signatureRequests.downloadPdfStream`). */
export interface PdfStream {
  /** The PDF bytes. Read it once. */
  body: ReadableStream<Uint8Array>;
  /** The `X-File-Sha256` fingerprint sent by the API, to compare with the bytes you store. */
  sha256: string | null;
  /** The file name from `Content-Disposition`, when sent. */
  filename: string | null;
  /** `Content-Length`, when sent. */
  contentLength: number | null;
}

// ---------------------------------------------------------------------------------------------------------
// Sessions

export interface SessionSigner {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: SignerStatus | (string & {});
  sign_url: string | null;
}

export interface Session {
  /** The session id is the signature request id; every `signatureRequests` method works on it. */
  id: string;
  object: 'session';
  status: SignatureRequestStatus | (string & {});
  workflow_id: string;
  workflow_version: number | null;
  vendor_data: string | null;
  channel: Channel;
  signers: SessionSigner[];
  /** Only when there is exactly one signer. */
  sign_url?: string;
  created_at: number;
  expires_at: number | null;
  livemode: boolean;
  cost: { amount: number; currency: Currency; source: 'plan' | 'overage' | null };
  return_url?: string;
  trial?: boolean;
}

export interface SessionSignerInput {
  name: string;
  email?: string;
  phone?: string;
  type?: SignerType;
  fields?: Record<string, unknown>;
  /** Required for every signer when the workflow requires an access code. */
  access_code?: string;
}

export interface SessionCreateParams {
  /** `wf_…` of a published workflow, or `default`. */
  workflow_id: string;
  template_id?: string | number;
  document_id?: string;
  signers: SessionSignerInput[];
  signature_method?: 'simple' | 'identity' | 'token';
  channel?: Channel;
  language?: Language;
  /** Days, 1–30. */
  expires_in?: number;
  require_id_attachment?: boolean;
  cc?: (string | { name?: string; email: string })[];
  /** `https://` URL on an accepted domain of the account. */
  return_url?: string;
  vendor_data?: string | number;
  title?: string;
  fields?: Record<string, unknown>;
  metadata?: JsonObject;
}

export interface SessionListParams extends ListParams {
  workflow_id?: string;
  vendor_data?: string;
  status?: SignatureRequestStatus;
}

// ---------------------------------------------------------------------------------------------------------
// Embedded signing

export interface SigningSessionCreateParams {
  /** `iframe` (default, plan feature `embed`) or `redirect`. */
  mode?: 'iframe' | 'redirect';
  /** Iframe mode only. */
  return_url?: string;
  /** Required in redirect mode. */
  success_url?: string;
  cancel_url?: string;
}

export interface SigningSession {
  object: 'signing_session';
  signer: string;
  mode: 'iframe' | 'redirect';
  /** Valid for 30 minutes. */
  signing_url: string;
  expires_at: number;
  success_url?: string;
  cancel_url?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Documents

export interface DocumentFieldPlacement {
  key: string;
  label?: string;
  type?: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required?: boolean;
  signer?: number | string;
}

export interface DocumentCreateParams {
  /** `pdf` (default) or `contract`. */
  kind?: 'pdf' | 'contract';
  /** Field placements (sent as a JSON string). */
  field_map?: DocumentFieldPlacement[] | string;
  /** File name sent with the upload (defaults to the file's own name or `document.pdf`). */
  filename?: string;
}

export interface Document {
  id: string;
  object: 'document';
  kind: 'pdf' | 'contract';
  filename: string;
  pages: number;
  bytes: number;
  sha256: string;
  fields: unknown[];
  created_at: number;
}

// ---------------------------------------------------------------------------------------------------------
// Identity verifications and public verification

export interface IdentityVerification {
  id: string;
  object: 'identity_verification';
  provider: string;
  signer: string | null;
  status:
    'pending' | 'approved' | 'in_review' | 'resubmission_requested' | 'declined' | 'expired' | (string & {});
  level: LegalLevel | (string & {});
  verification_url: string | null;
  created_at: number;
}

export interface Verification {
  object: 'verification';
  reference: string;
  /** False when the reference is unknown (the API answers 404; this library returns the object). */
  found: boolean;
  status: 'completed' | 'in_progress' | 'not_found' | (string & {});
  integrity: 'intact' | 'modified' | 'unknown';
  structure?: string;
  document?: {
    title: string;
    sha256: string;
    hash_alg: 'hmac-sha256' | 'sha256' | (string & {});
    format: string;
    legal_level: LegalLevel | (string & {});
  };
  signed_at?: number | null;
  parties?: { name: string; email?: string; role: string; signed_at?: number | null }[];
  events?: { type: string; at: number }[];
  qr?: string;
}

// ---------------------------------------------------------------------------------------------------------
// Webhook endpoints and events

export interface WebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  url: string;
  enabled_events: (EventType | '*')[];
  status: 'enabled' | 'disabled';
  livemode: boolean;
  created_at: number;
  /** Only in the `create` response. Store it then. */
  secret?: string;
}

export interface DeletedWebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  deleted: true;
}

export interface WebhookEndpointCreateParams {
  /** Public `https://` URL. */
  url: string;
  /** Event types or `['*']` (default). */
  enabled_events?: (EventType | '*')[];
}

export interface WebhookEndpointUpdateParams {
  enabled_events?: (EventType | '*')[];
  status?: 'enabled' | 'disabled';
}

export interface WebhookDelivery {
  object: 'webhook_delivery';
  event: string;
  event_type: EventType | (string & {});
  status: 'pending' | 'sending' | 'succeeded' | 'failed';
  attempts: number;
  response_code: number | null;
  created_at: number;
  updated_at: number;
}

export interface WebhookTestResult {
  object: 'webhook_test';
  endpoint: string;
  response_code: number | null;
  error: string;
  ok: boolean;
}

/** `data.object` of a `verification.created` event. */
export interface VerificationEventObject {
  object: 'verification';
  reference: string;
  verify_url: string;
  signature_request: string;
  created_at: number;
  workflow_id?: string;
  workflow_version?: number | null;
  vendor_data?: string;
}

interface EventObjectMap {
  'signature_request.created': SignatureRequest;
  'signature_request.sent': SignatureRequest;
  'signature_request.viewed': SignatureRequest;
  'signature_request.partially_signed': SignatureRequest;
  'signature_request.completed': SignatureRequest;
  'signature_request.declined': SignatureRequest;
  'signature_request.expired': SignatureRequest;
  'signature_request.canceled': SignatureRequest;
  'signer.sent': SignerEventObject;
  'signer.viewed': SignerEventObject;
  'signer.otp_verified': SignerEventObject;
  'signer.identity_verified': SignerEventObject;
  'signer.identity_in_review': SignerEventObject;
  'signer.identity_resubmission_requested': SignerEventObject;
  'signer.identity_declined': SignerEventObject;
  'signer.identity_match_hold': SignerEventObject;
  'signer.identity_match_decided': SignerEventObject;
  'signer.signed': SignerEventObject;
  'signer.declined': SignerEventObject;
  'document.sealed': SignatureRequest;
  'verification.created': VerificationEventObject;
}

/** A webhook event envelope for one event type. */
export interface TypedEvent<K extends EventType> {
  id: string;
  object: 'event';
  type: K;
  created_at: number;
  livemode: boolean;
  data: { object: EventObjectMap[K] };
}

/**
 * A webhook event (also returned by `events.list/retrieve`). Narrow on `type` to get a typed `data.object`.
 */
export type WthaiqEvent = { [K in EventType]: TypedEvent<K> }[EventType];

export interface EventListParams extends ListParams {
  type?: EventType;
}

export interface EventRedeliverParams {
  /** `we_…`; defaults to every enabled endpoint subscribed to the event type. */
  endpoint?: string;
}

export interface EventRedelivery {
  object: 'event_redelivery';
  event: string;
  deliveries: {
    endpoint: string;
    status: 'succeeded' | 'failed' | 'pending';
    response_code: number | null;
    error: string | null;
  }[];
}

// ---------------------------------------------------------------------------------------------------------
// Flows

export interface Flow {
  id: string;
  object: 'flow';
  name: string;
  template_id: string | null;
  legal_level: LegalLevel;
  reminders: boolean;
  lock_contract: boolean;
  cc: (string | CcRecipient)[];
  created_at: number;
}

/**
 * Every webhook event type the API can emit, in the order returned by
 * `GET /webhook_endpoints/event_types`.
 */
export const EVENT_TYPES = [
  'signature_request.created',
  'signature_request.sent',
  'signature_request.viewed',
  'signature_request.partially_signed',
  'signature_request.completed',
  'signature_request.declined',
  'signature_request.expired',
  'signature_request.canceled',
  'signer.sent',
  'signer.viewed',
  'signer.otp_verified',
  'signer.identity_verified',
  'signer.identity_in_review',
  'signer.identity_resubmission_requested',
  'signer.identity_declined',
  'signer.identity_match_hold',
  'signer.identity_match_decided',
  'signer.signed',
  'signer.declined',
  'document.sealed',
  'verification.created',
] as const;

/** A webhook event type. */
export type EventType = (typeof EVENT_TYPES)[number];

/** Subscribe an endpoint to every event type. */
export const ALL_EVENTS = '*';

/** Event types whose `data.object` is a signature request. */
export type SignatureRequestEventType = Extract<EventType, `signature_request.${string}`> | 'document.sealed';

/** Event types whose `data.object` is a signer (with request context). */
export type SignerEventType = Extract<EventType, `signer.${string}`>;

/** Returns true when `value` is an event type known to this version of the library. */
export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

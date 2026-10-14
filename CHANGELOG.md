# Changelog

All notable changes to this library are documented in this file. The project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-14

First release, targeting API version `2026-07-01`.

### Added

- `Wthaiq` client with resources for every endpoint: `account`, `usage`, `balance`, `templates`,
  `signatureRequests`, `sessions`, `signers`, `documents`, `identityVerifications`, `verifications`,
  `webhookEndpoints`, `events` and `flows`.
- Typed request parameters and response objects (TypeScript declarations for ESM and CommonJS).
- `list()` returns one page when awaited and walks every page with `for await`; `all()` returns an
  auto-paginating iterator with `toArray(limit)`.
- Final PDF download as a verified `Buffer` (`downloadPdf`), to a file written atomically (`downloadPdfTo`),
  or as a stream (`downloadPdfStream`). PDF upload from a path, bytes, a `Blob` or `{ content, filename }`.
- Typed errors (`ValidationError`, `AuthenticationError`, `PermissionError`, `PaymentRequiredError`,
  `NotFoundError`, `ConflictError`, `RateLimitError`, `ServerError`, `ApiConnectionError`, …) carrying
  `code`, `param`, `requestId` and the raw response.
- Automatic retries with exponential backoff and jitter that honour `Retry-After`, automatic idempotency keys
  on every `POST` (reused across retries), per-attempt timeouts and `AbortSignal` support.
- `Webhook.constructEvent()` (also `wt.webhooks.constructEvent()`), `verifyHeader()`, `isValid()`,
  `computeSignature()` and `generateTestHeader()`, with constant-time comparison; synchronous and free of
  runtime dependencies.
- HTTP metadata on every response (`lastResponse`: status, headers, request id, idempotent replay, rate limit).
- Zero runtime dependencies; Node.js 18, 20, 22 and later; custom `fetch` support.
- Event types `signer.identity_match_hold` and `signer.identity_match_decided` in `EVENT_TYPES`, `isEventType()`
  and the typed `WthaiqEvent` union: the name on the signer's identity document differs from the name in the
  request, and the decision on that difference. `EVENT_TYPES` now lists 21 types.
- `signers.decideIdentityMatch(id, { decision: 'approve' | 'reject', note? })` for
  `POST /signers/{id}/identity_match`: decides a name difference held for review and returns the signer.
- `NameMatch` type: `identity.name_match` on signers, `name_match` on identity verifications, and
  `identity_match` on the `data.object` of the two name-match events (`SignerIdentityMatchEventObject`).
- `TooManySignersError` (a `ValidationError`) for `400 too_many_signers`, with `maxSigners` read from the
  error's `max_signers` (falls back to the new `MAX_SIGNERS` constant, 5).
- `PermissionError.verifyUrl` reads `verify_url` from `kyb_required` errors (falls back to `VERIFY_URL`).
  `PaymentRequiredError.upgradeUrl` and `PermissionError.upgradeUrl` read the `upgrade_url` the API now sends
  on `plan_required`, `plan_expired` and `plan_feature_unavailable`.
- Client option `language` (`'en'` or `'ar'`), sent as `Accept-Language`, for English error messages. The
  default is unchanged: no header, Arabic messages. Error codes do not change with the language.
- `webhookEndpoints.list()` and `all()` accept `starting_after` and follow `next_cursor` across pages, now that
  the API paginates webhook endpoints like other lists.
- `verifications.retrieve()` also resolves to `{ found: false, status: 'not_found' }` when the API answers an
  unknown reference with a `404` error whose code is `not_found`, so its result does not depend on the server
  version.

[1.0.0]: https://github.com/wthaiq/wthaiq-node/releases/tag/v1.0.0

# Changelog

All notable changes to this library are documented in this file. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Event types `signer.identity_match_hold` and `signer.identity_match_decided` in `EVENT_TYPES`, `isEventType()`
  and the typed `WthaiqEvent` union: the name on the signer's identity document differs from the name in the
  request, and the decision on that difference. `EVENT_TYPES` now lists 21 types.

## [1.0.0] - 2026-10-07

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

[Unreleased]: https://github.com/wthaiq/wthaiq-node/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wthaiq/wthaiq-node/releases/tag/v1.0.0

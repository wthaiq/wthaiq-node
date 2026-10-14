/** Version of this library. */
export const VERSION = '1.0.0';

/** Wthaiq API version this release targets (sent as the `Wthaiq-Version` header). */
export const API_VERSION = '2026-07-01';

/** Default API base URL. */
export const DEFAULT_BASE_URL = 'https://wthaiq.com/api/v1';

/** Page where a plan can be bought or upgraded. */
export const PLANS_URL = 'https://developers.wthaiq.com/plans';

/** Page where the company verification required for live mode is completed. */
export const VERIFY_URL = 'https://developers.wthaiq.com/verify';

/** Most signers allowed in one live signature request (the `too_many_signers` limit). */
export const MAX_SIGNERS = 5;

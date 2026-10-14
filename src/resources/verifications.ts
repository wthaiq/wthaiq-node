import { isRecord, NotFoundError } from '../core/errors.js';
import type { RequestOptions } from '../core/requestor.js';
import { attachResponse, ResponseMeta, type WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Verification } from '../types.js';
import { ApiResource } from './base.js';

/** Public verification of a completed signature by its reference (`WTQ-…`). */
export class Verifications extends ApiResource {
  /**
   * Looks up a verification reference. An unknown reference resolves to an object with `found: false`
   * instead of throwing: the API answers 404, either with a verification body or with the error code
   * `not_found`.
   */
  async retrieve(reference: string, options?: RequestOptions): Promise<WthaiqResponse<Verification>> {
    try {
      return await this.requestor.json<Verification>(
        'GET',
        buildPath`/verifications/${reference}`,
        undefined,
        options,
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(error.rawBody);
        } catch {
          throw error;
        }
        if (isRecord(decoded) && decoded['object'] === 'verification' && decoded['error'] === undefined) {
          return attachResponse(
            decoded as unknown as Verification,
            new ResponseMeta(error.statusCode, { ...error.headers }),
          );
        }
        if (error.code === 'not_found') {
          const missing: Verification = {
            object: 'verification',
            reference,
            found: false,
            status: 'not_found',
            integrity: 'unknown',
          };
          return attachResponse(missing, new ResponseMeta(error.statusCode, { ...error.headers }));
        }
      }
      throw error;
    }
  }
}

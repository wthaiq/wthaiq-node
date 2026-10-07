import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { IdentityVerification } from '../types.js';
import { ApiResource } from './base.js';

/** Identity verification records of signers (`idv_…`). */
export class IdentityVerifications extends ApiResource {
  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<IdentityVerification>> {
    return this.requestor.json<IdentityVerification>(
      'GET',
      buildPath`/identity_verifications/${id}`,
      undefined,
      options,
    );
  }
}

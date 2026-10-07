import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Signer, SigningSession, SigningSessionCreateParams } from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/** Signers and embedded signing links. */
export class Signers extends ApiResource {
  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<Signer>> {
    return this.requestor.json<Signer>('GET', buildPath`/signers/${id}`, undefined, options);
  }

  /** Creates a signing link valid for 30 minutes, for an iframe or a redirect. */
  async createSigningSession(
    id: string,
    params?: SigningSessionCreateParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<SigningSession>> {
    return this.requestor.json<SigningSession>(
      'POST',
      buildPath`/signers/${id}/signing_session`,
      paramsObject(params),
      options,
    );
  }
}

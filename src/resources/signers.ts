import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type {
  IdentityMatchDecisionParams,
  Signer,
  SigningSession,
  SigningSessionCreateParams,
} from '../types.js';
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

  /**
   * Decides a name difference held for review (`identity.name_match.state === 'awaiting'`, announced by the
   * `signer.identity_match_hold` event): `approve` lets the signer finish signing, `reject` stops this signer.
   * Secret keys only. Throws `ConflictError` (`identity_match_not_pending`) when nothing awaits a decision,
   * and `NotFoundError` when the signer has no name difference to decide.
   */
  async decideIdentityMatch(
    id: string,
    params: IdentityMatchDecisionParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<Signer>> {
    return this.requestor.json<Signer>(
      'POST',
      buildPath`/signers/${id}/identity_match`,
      paramsObject(params),
      options,
    );
  }
}

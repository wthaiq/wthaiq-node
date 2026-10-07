import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Session, SessionCreateParams, SessionListParams } from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/**
 * Signature requests created from a workflow (`wf_…` or `default`). The session id is the request id, so
 * every `signatureRequests` method works on it too.
 */
export class Sessions extends ApiResource {
  async create(params: SessionCreateParams, options?: RequestOptions): Promise<WthaiqResponse<Session>> {
    return this.requestor.json<Session>('POST', '/sessions', paramsObject(params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<Session>> {
    return this.requestor.json<Session>('GET', buildPath`/sessions/${id}`, undefined, options);
  }

  /** One page of sessions (`await`), or every session (`for await`). */
  list(params?: SessionListParams, options?: RequestOptions): PagePromise<Session> {
    return this.listPage<Session>('/sessions', params, options);
  }

  /** Every session, fetched page by page. */
  all(params?: SessionListParams, options?: RequestOptions): AutoPager<Session> {
    return this.autoPager<Session>('/sessions', params, options);
  }
}

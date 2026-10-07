import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Flow } from '../types.js';
import { ApiResource } from './base.js';

/** Embeddable console flows (read-only; created in the developer portal). */
export class Flows extends ApiResource {
  /** The flows of the account (a single page). */
  list(options?: RequestOptions): PagePromise<Flow> {
    return this.listPage<Flow>('/flows', undefined, options);
  }

  /** Every flow. */
  all(options?: RequestOptions): AutoPager<Flow> {
    return this.autoPager<Flow>('/flows', undefined, options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<Flow>> {
    return this.requestor.json<Flow>('GET', buildPath`/flows/${id}`, undefined, options);
  }
}

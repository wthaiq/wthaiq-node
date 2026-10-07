import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { EventListParams, EventRedeliverParams, EventRedelivery, WthaiqEvent } from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/** Webhook events of the account (newest first). */
export class Events extends ApiResource {
  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<WthaiqEvent>> {
    return this.requestor.json<WthaiqEvent>('GET', buildPath`/events/${id}`, undefined, options);
  }

  /** One page of events (`await`), or every event (`for await`). */
  list(params?: EventListParams, options?: RequestOptions): PagePromise<WthaiqEvent> {
    return this.listPage<WthaiqEvent>('/events', params, options);
  }

  /** Every event, fetched page by page. */
  all(params?: EventListParams, options?: RequestOptions): AutoPager<WthaiqEvent> {
    return this.autoPager<WthaiqEvent>('/events', params, options);
  }

  /** Delivers the event again, synchronously, to one endpoint or every subscribed endpoint. */
  async redeliver(
    id: string,
    params?: EventRedeliverParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<EventRedelivery>> {
    return this.requestor.json<EventRedelivery>(
      'POST',
      buildPath`/events/${id}/redeliver`,
      paramsObject(params),
      options,
    );
  }
}

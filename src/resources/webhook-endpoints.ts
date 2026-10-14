import { UnexpectedResponseError } from '../core/errors.js';
import type { EventType } from '../event-types.js';
import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type {
  DeletedWebhookEndpoint,
  ListParams,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreateParams,
  WebhookEndpointUpdateParams,
  WebhookTestResult,
} from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/** Webhook endpoints of the key's mode (test or live). */
export class WebhookEndpoints extends ApiResource {
  /** Creates an endpoint. The response carries `secret` (`whsec_…`) once: store it. */
  async create(
    params: WebhookEndpointCreateParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<WebhookEndpoint>> {
    return this.requestor.json<WebhookEndpoint>('POST', '/webhook_endpoints', paramsObject(params), options);
  }

  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<WebhookEndpoint>> {
    return this.requestor.json<WebhookEndpoint>(
      'GET',
      buildPath`/webhook_endpoints/${id}`,
      undefined,
      options,
    );
  }

  /** Changes the subscribed events or enables/disables the endpoint. The URL cannot be changed. */
  async update(
    id: string,
    params: WebhookEndpointUpdateParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<WebhookEndpoint>> {
    return this.requestor.json<WebhookEndpoint>(
      'POST',
      buildPath`/webhook_endpoints/${id}`,
      paramsObject(params),
      options,
    );
  }

  /** Deletes the endpoint permanently. */
  async delete(id: string, options?: RequestOptions): Promise<WthaiqResponse<DeletedWebhookEndpoint>> {
    return this.requestor.json<DeletedWebhookEndpoint>(
      'DELETE',
      buildPath`/webhook_endpoints/${id}`,
      undefined,
      options,
    );
  }

  /** One page of endpoints (newest first). Iterate with `for await` to walk every page. */
  list(params?: ListParams, options?: RequestOptions): PagePromise<WebhookEndpoint> {
    return this.listPage<WebhookEndpoint>('/webhook_endpoints', params, options);
  }

  /** Every endpoint. */
  all(params?: ListParams, options?: RequestOptions): AutoPager<WebhookEndpoint> {
    return this.autoPager<WebhookEndpoint>('/webhook_endpoints', params, options);
  }

  /** The last 50 delivery attempts of the endpoint. */
  deliveries(id: string, options?: RequestOptions): PagePromise<WebhookDelivery> {
    return this.listPage<WebhookDelivery>(
      () => buildPath`/webhook_endpoints/${id}/deliveries`,
      undefined,
      options,
    );
  }

  /** Sends a synthetic `signature_request.completed` event to the endpoint and reports the result. */
  async test(id: string, options?: RequestOptions): Promise<WthaiqResponse<WebhookTestResult>> {
    return this.requestor.json<WebhookTestResult>(
      'POST',
      buildPath`/webhook_endpoints/${id}/test`,
      {},
      options,
    );
  }

  /** Every event type an endpoint can subscribe to. */
  async eventTypes(options?: RequestOptions): Promise<EventType[]> {
    const list = await this.requestor.json<{ data?: unknown }>(
      'GET',
      '/webhook_endpoints/event_types',
      undefined,
      options,
    );
    if (!Array.isArray(list.data)) {
      throw new UnexpectedResponseError('Unexpected response for the event type list.', {
        statusCode: list.lastResponse.statusCode,
      });
    }
    return list.data.filter((type): type is EventType => typeof type === 'string');
  }
}

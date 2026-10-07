import type { AutoPager, PagePromise } from '../core/pagination.js';
import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Template, TemplateCreateParams, TemplateListParams, TemplateRetrieveParams } from '../types.js';
import { ApiResource, paramsObject } from './base.js';

/** Contract templates: your own (`scope: 'mine'`) and the public catalogue. */
export class Templates extends ApiResource {
  /** Creates a private template from HTML with `{{key}}` placeholders. */
  async create(params: TemplateCreateParams, options?: RequestOptions): Promise<WthaiqResponse<Template>> {
    return this.requestor.json<Template>('POST', '/templates', paramsObject(params), options);
  }

  /** Retrieves a template by `tpl_123`, `123` or exact title. Pass `{ include: 'content' }` for the HTML. */
  async retrieve(
    id: string,
    params?: TemplateRetrieveParams,
    options?: RequestOptions,
  ): Promise<WthaiqResponse<Template>> {
    return this.requestor.json<Template>('GET', buildPath`/templates/${id}`, paramsObject(params), options);
  }

  /** One page of templates (`await`), or every template (`for await`). */
  list(params?: TemplateListParams, options?: RequestOptions): PagePromise<Template> {
    return this.listPage<Template>('/templates', params, options);
  }

  /** Every template, fetched page by page. */
  all(params?: TemplateListParams, options?: RequestOptions): AutoPager<Template> {
    return this.autoPager<Template>('/templates', params, options);
  }
}

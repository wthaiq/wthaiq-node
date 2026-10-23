import type { RequestOptions } from '../core/requestor.js';
import type { WthaiqResponse } from '../core/response.js';
import { buildPath } from '../core/util.js';
import type { Document } from '../types.js';
import { ApiResource } from './base.js';

/** Previously uploaded PDF documents (the API no longer accepts uploads). */
export class Documents extends ApiResource {
  async retrieve(id: string, options?: RequestOptions): Promise<WthaiqResponse<Document>> {
    return this.requestor.json<Document>('GET', buildPath`/documents/${id}`, undefined, options);
  }
}

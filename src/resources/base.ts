import { InvalidArgumentError } from '../core/errors.js';
import { AutoPager, Page, PagePromise, type ListObject } from '../core/pagination.js';
import type { RequestOptions, Requestor } from '../core/requestor.js';

/** Shared plumbing of the resource classes. */
export abstract class ApiResource {
  /** @internal */
  protected readonly requestor: Requestor;

  /** @internal */
  constructor(requestor: Requestor) {
    this.requestor = requestor;
  }

  /**
   * A lazy page request. Invalid arguments surface as a rejection when the result is awaited or iterated.
   *
   * @internal
   */
  protected listPage<T>(
    path: string | (() => string),
    params: object | undefined,
    options: RequestOptions | undefined,
  ): PagePromise<T> {
    return new PagePromise<T>(this.firstPageLoader<T>(path, params, options));
  }

  /** @internal */
  protected autoPager<T>(
    path: string | (() => string),
    params: object | undefined,
    options: RequestOptions | undefined,
  ): AutoPager<T> {
    return new AutoPager<T>(this.firstPageLoader<T>(path, params, options));
  }

  private firstPageLoader<T>(
    path: string | (() => string),
    params: object | undefined,
    options: RequestOptions | undefined,
  ): () => Promise<Page<T>> {
    return async () => {
      const resolved = typeof path === 'function' ? path() : path;
      const load = async (pageParams: Record<string, unknown>): Promise<Page<T>> => {
        const list = await this.requestor.json<Partial<ListObject<T>>>('GET', resolved, pageParams, options);
        return new Page<T>(list, pageParams, load);
      };
      return load(paramsObject(params));
    };
  }
}

/** @internal */
export function paramsObject(params: object | undefined, name = 'params'): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== 'object' || Array.isArray(params)) {
    throw new InvalidArgumentError(`${name} must be a plain object.`);
  }
  return { ...(params as Record<string, unknown>) };
}

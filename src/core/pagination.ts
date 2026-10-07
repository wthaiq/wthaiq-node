import { UnexpectedResponseError } from './errors.js';
import { ResponseMeta, type WthaiqResponse } from './response.js';

/** The JSON shape of every list response. */
export interface ListObject<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

type PageParams = Record<string, unknown>;
type PageLoader<T> = (params: PageParams) => Promise<Page<T>>;

/**
 * One page of a list. Iterating a page with `for await` walks this page and every following page.
 */
export class Page<T> implements AsyncIterable<T> {
  readonly object = 'list' as const;
  readonly data: T[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
  declare readonly lastResponse: ResponseMeta;
  readonly #params: PageParams;
  readonly #load: PageLoader<T>;

  /** @internal */
  constructor(list: WthaiqResponse<Partial<ListObject<T>>>, params: PageParams, load: PageLoader<T>) {
    if (!Array.isArray(list.data)) {
      throw new UnexpectedResponseError('The Wthaiq API returned a list without a data array.', {
        statusCode: list.lastResponse.statusCode,
      });
    }
    this.data = list.data;
    this.has_more = list.has_more === true;
    this.next_cursor =
      typeof list.next_cursor === 'string' && list.next_cursor !== '' ? list.next_cursor : null;
    Object.defineProperty(this, 'lastResponse', { value: list.lastResponse, enumerable: false });
    this.#params = params;
    this.#load = load;
  }

  /** True when the API reported more items after this page. */
  hasNextPage(): boolean {
    return this.has_more && this.next_cursor !== null;
  }

  /** The parameters that fetch the next page (`starting_after` = `next_cursor`), or null. */
  nextPageParams(): PageParams | null {
    if (!this.hasNextPage()) return null;
    return { ...this.#params, starting_after: this.next_cursor };
  }

  /** Fetches the next page, or resolves to null when this is the last page. */
  async getNextPage(): Promise<Page<T> | null> {
    const params = this.nextPageParams();
    return params === null ? null : this.#load(params);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return iterateFrom(this);
  }

  toJSON(): ListObject<T> {
    return { object: 'list', data: this.data, has_more: this.has_more, next_cursor: this.next_cursor };
  }
}

/**
 * Iterates every item from `first` onward. Stops when a page has no next cursor, is empty, or repeats a
 * cursor already followed (the API ignores unknown cursors instead of failing).
 */
async function* iterateFrom<T>(first: Page<T>): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>();
  let page: Page<T> | null = first;
  while (page !== null) {
    for (const item of page.data) yield item;
    const cursor = page.next_cursor;
    if (!page.hasNextPage() || cursor === null || page.data.length === 0 || seen.has(cursor)) return;
    seen.add(cursor);
    page = await page.getNextPage();
  }
}

/** A lazy, auto-paginating sequence of every item of a list. */
export class AutoPager<T> implements AsyncIterable<T> {
  /** @internal */
  protected readonly load: () => Promise<Page<T>>;

  /** @internal */
  constructor(load: () => Promise<Page<T>>) {
    this.load = load;
  }

  /** @internal */
  protected firstPage(): Promise<Page<T>> {
    return this.load();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    yield* iterateFrom(await this.firstPage());
  }

  /** Collects the items into an array, stopping after `limit` items when given. */
  async toArray(limit?: number): Promise<T[]> {
    const out: T[] = [];
    if (limit !== undefined && limit <= 0) return out;
    for await (const item of this) {
      out.push(item);
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }
}

/**
 * Returned by `list()`: `await` it for one {@link Page}, or iterate it with `for await` to walk every item
 * across pages. Nothing is sent until it is awaited or iterated, and the first page is fetched only once.
 */
export class PagePromise<T> extends AutoPager<T> implements PromiseLike<Page<T>> {
  #promise: Promise<Page<T>> | undefined;

  /** @internal */
  protected override firstPage(): Promise<Page<T>> {
    this.#promise ??= this.load();
    return this.#promise;
  }

  then<R1 = Page<T>, R2 = never>(
    onFulfilled?: ((value: Page<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.firstPage().then(onFulfilled, onRejected);
  }

  catch<R = never>(onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Page<T> | R> {
    return this.firstPage().catch(onRejected);
  }

  finally(onFinally?: (() => void) | null): Promise<Page<T>> {
    return this.firstPage().finally(onFinally);
  }

  readonly [Symbol.toStringTag] = 'PagePromise';
}

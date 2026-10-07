import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AutoPager, Page, PagePromise, UnexpectedResponseError } from '../src/index.js';
import { json, list, makeClient, query } from './helpers.js';

const sr = (n: number): Record<string, unknown> => ({ id: `sr_${n}`, object: 'signature_request' });

describe('pagination', () => {
  it('returns one page when awaited', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([sr(3), sr(2)], true, 'sr_2')));
    const promise = wt.signatureRequests.list({ limit: 2, status: 'sent' });
    assert.ok(promise instanceof PagePromise);
    assert.equal(mock.requests.length, 0, 'nothing is sent before await');
    const page = await promise;
    assert.ok(page instanceof Page);
    assert.equal(page.object, 'list');
    assert.deepEqual(
      page.data.map((item) => item.id),
      ['sr_3', 'sr_2'],
    );
    assert.equal(page.has_more, true);
    assert.equal(page.next_cursor, 'sr_2');
    assert.equal(page.hasNextPage(), true);
    assert.deepEqual(page.nextPageParams(), { limit: 2, status: 'sent', starting_after: 'sr_2' });
    assert.equal(page.lastResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(page)), list([sr(3), sr(2)], true, 'sr_2'));
    assert.deepEqual(query(mock.last), { limit: '2', status: 'sent' });

    mock.push(json(200, list([sr(1)], false, null)));
    const next = await page.getNextPage();
    assert.ok(next !== null);
    assert.deepEqual(query(mock.last), { limit: '2', status: 'sent', starting_after: 'sr_2' });
    assert.equal(next.hasNextPage(), false);
    assert.equal(next.nextPageParams(), null);
    assert.equal(await next.getNextPage(), null);
  });

  it('walks every page with for await, keeping the filters', async () => {
    const { wt, mock } = makeClient();
    mock.push(
      json(200, list([sr(5), sr(4)], true, 'sr_4')),
      json(200, list([sr(3), sr(2)], true, 'sr_2')),
      json(200, list([sr(1)], false, null)),
    );
    const ids: string[] = [];
    for await (const item of wt.signatureRequests.list({ status: 'completed', limit: 2 })) ids.push(item.id);
    assert.deepEqual(ids, ['sr_5', 'sr_4', 'sr_3', 'sr_2', 'sr_1']);
    assert.deepEqual(
      mock.requests.map((request) => query(request)['starting_after'] ?? null),
      [null, 'sr_4', 'sr_2'],
    );
    assert.ok(mock.requests.every((request) => query(request)['status'] === 'completed'));
  });

  it('fetches the first page once when a PagePromise is awaited and then iterated', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([sr(2), sr(1)], false, null)));
    const promise = wt.templates.list();
    const page = await promise;
    const items: unknown[] = [];
    for await (const item of promise) items.push(item);
    assert.equal(items.length, 2);
    assert.equal(page.data.length, 2);
    assert.equal(mock.requests.length, 1);
  });

  it('iterates from a page object', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([sr(2)], true, 'sr_2')), json(200, list([sr(1)], false, null)));
    const page = await wt.events.list({ type: 'signer.signed' });
    const ids: string[] = [];
    for await (const item of page) ids.push(item.id);
    assert.deepEqual(ids, ['sr_2', 'sr_1']);
  });

  it('stops when the API repeats a cursor', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([sr(2)], true, 'sr_x')), json(200, list([sr(2)], true, 'sr_x')));
    const items = await wt.signatureRequests.all().toArray();
    assert.equal(items.length, 2);
    assert.equal(mock.requests.length, 2);
  });

  it('stops on an empty page even if has_more is true', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([], true, 'sr_9')));
    assert.deepEqual(await wt.sessions.all().toArray(), []);
    assert.equal(mock.requests.length, 1);
  });

  it('stops when next_cursor is missing even if has_more is true (single-page lists)', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'list', data: [{ id: 'we_1' }, { id: 'we_2' }], has_more: true }));
    const endpoints = await wt.webhookEndpoints.all({ limit: 2 }).toArray();
    assert.equal(endpoints.length, 2);
    assert.equal(mock.requests.length, 1);
  });

  it('all() returns an AutoPager that refetches on each iteration and honours a limit', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, list([sr(3), sr(2)], true, 'sr_2')), json(200, list([sr(3), sr(2)], true, 'sr_2')));
    const pager = wt.signatureRequests.all({ limit: 2 });
    assert.ok(pager instanceof AutoPager);
    assert.equal((await pager.toArray(1)).length, 1);
    assert.deepEqual(await pager.toArray(0), []);
    assert.equal((await pager.toArray(2)).length, 2);
    assert.equal(mock.requests.length, 2);
  });

  it('can be used with then/catch/finally', async () => {
    const { wt, mock } = makeClient({ maxRetries: 0 });
    mock.push(json(200, list([sr(1)])), json(500, { error: { code: 'internal_error', message: 'x' } }));
    const count = await wt.flows.list().then((page) => page.data.length);
    assert.equal(count, 1);
    let finished = false;
    const caught = await wt.flows
      .list()
      .finally(() => {
        finished = true;
      })
      .catch((error: unknown) => error);
    assert.ok(caught instanceof Error);
    assert.equal(finished, true);
    assert.equal(Object.prototype.toString.call(wt.flows.list()), '[object PagePromise]');
  });

  it('rejects a list response without data', async () => {
    const { wt, mock } = makeClient();
    mock.push(json(200, { object: 'list' }));
    await assert.rejects(async () => wt.templates.list(), UnexpectedResponseError);
  });
});

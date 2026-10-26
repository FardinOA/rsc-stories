import { afterEach, describe, expect, it, vi } from 'vitest';
import { compilePattern, interceptFetch, matchRequest, readBody, toResponse } from '../../src/shared/fetch-mock';
import { resolveMocks } from '../../src/runtime/server/mocks';
import { NEVER_RESOLVE } from '../../src/shared/state';
import { calls, makeStore, storage, useMocks } from '../helpers/store';

const req = (url: string, init?: RequestInit) => new Request(url, init);

describe('matchers (FR-3.1)', () => {
  it('matches string patterns with methods, wildcards and params', async () => {
    expect(await matchRequest('https://api.test/users', req('https://api.test/users?page=2'), undefined)).toEqual({});
    expect(await matchRequest('GET https://api.test/users', req('https://api.test/users', { method: 'POST' }), undefined)).toBeNull();
    expect(await matchRequest('https://api.test/users/:id', req('https://api.test/users/42'), undefined)).toEqual({ id: '42' });
    expect(await matchRequest('/users/*', req('https://any.host/users/1/posts'), undefined)).toEqual({});
    expect(await matchRequest('/search?q=a', req('https://x.y/search?q=b'), undefined)).toBeNull();
    expect(await matchRequest('http://localhost:3000/a', req('http://localhost:3000/a'), undefined)).toEqual({});
    expect(compilePattern('POST /x').method).toBe('POST');
  });

  it('matches regexes, predicates and object matchers', async () => {
    expect(await matchRequest(/users\/\d+/, req('https://a.b/users/7'), undefined)).toEqual({});
    expect(await matchRequest((r) => r.headers.get('x-a') === '1', req('https://a.b', { headers: { 'x-a': '1' } }), undefined)).toEqual({});
    const post = req('https://api.test/orders/9?expand=1', { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"qty":2}' });
    const body = await readBody(post);
    expect(body).toEqual({ qty: 2 });
    expect(
      await matchRequest(
        {
          url: 'https://api.test/orders/:id',
          method: 'post',
          query: { expand: '1' },
          headers: { authorization: /^Bearer/ },
          body: (b) => (b as { qty: number }).qty === 2,
        },
        post,
        body,
      ),
    ).toEqual({ id: '9' });
    expect(await matchRequest({ url: /orders/, method: 'GET' }, post, body)).toBeNull();
    expect(await matchRequest({ headers: { 'x-missing': 'a' } }, post, body)).toBeNull();
    expect(await matchRequest({ query: { expand: '2' } }, post, body)).toBeNull();
    expect(await readBody(req('https://a.b'))).toBeUndefined();
    expect(await readBody(req('https://a.b', { method: 'POST', body: 'plain' }))).toBe('plain');
  });
});

describe('toResponse', () => {
  const info = { url: new URL('https://a.b'), method: 'GET', params: {}, body: undefined };
  it('serializes plain values, strings, null and Response objects', async () => {
    const json = await toResponse({ a: 1 }, req('https://a.b'), info, 201, { 'x-y': 'z' });
    expect(json.status).toBe(201);
    expect(json.headers.get('x-y')).toBe('z');
    expect(await json.json()).toEqual({ a: 1 });
    expect(await (await toResponse('hi', req('https://a.b'), info)).text()).toBe('hi');
    expect(await (await toResponse(null, req('https://a.b'), info)).json()).toBeNull();
    expect((await toResponse(undefined, req('https://a.b'), info, 204)).status).toBe(204);
    const original = new Response('body');
    const copy = await toResponse(original, req('https://a.b'), info);
    expect(await copy.text()).toBe('body');
    expect(await (await toResponse(original, req('https://a.b'), info)).text()).toBe('body');
  });

  it('calls function responses with request info', async () => {
    const response = await toResponse((_r: Request, i: { params: Record<string, string> }) => ({ id: i.params.id }), req('https://a.b'), {
      ...info,
      params: { id: '3' },
    });
    expect(await response.json()).toEqual({ id: '3' });
  });
});

describe('interceptFetch (FR-3.6, FR-3.8, FR-3.10)', () => {
  afterEach(() => useMocks(undefined));
  const original = vi.fn(async () => new Response('network'));

  it('answers from the first matching mock and records the call', async () => {
    useMocks(resolveMocks([{ fetch: [{ name: 'user', match: 'https://api.test/user', response: { name: 'Ada' } }] }]));
    const store = makeStore();
    const response = await storage.run(store, () => interceptFetch(store, 'https://api.test/user', undefined, original));
    expect(await response.json()).toEqual({ name: 'Ada' });
    expect(original).not.toHaveBeenCalled();
    expect(calls(store)).toMatchObject([
      { kind: 'fetch', key: 'fetch:user', mocked: true, status: 'ok', result: { status: 200, body: { name: 'Ada' } } },
    ]);
  });

  it('applies variants, latency and errors', async () => {
    useMocks(
      resolveMocks(
        [{ fetch: [{ name: 'user', match: 'https://api.test/user', response: 'ok', variants: { down: { error: 'ECONNREFUSED' } } }] }],
        {
          variants: { 'fetch:user': 'down' },
        },
      ),
    );
    const store = makeStore();
    await expect(interceptFetch(store, 'https://api.test/user', undefined, original)).rejects.toThrow('fetch failed: ECONNREFUSED');
    expect(calls(store)[0]).toMatchObject({ status: 'error', variant: 'down' });

    useMocks(resolveMocks([{ fetch: [{ match: '/slow', response: 'done', delay: 20 }] }]));
    const timed = makeStore();
    const started = performance.now();
    await interceptFetch(timed, 'https://x.y/slow', undefined, original);
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('keeps never-resolving latency pending', async () => {
    useMocks(resolveMocks([{ fetch: [{ match: '/hang', response: 'x' }], latency: { fetch: NEVER_RESOLVE } }]));
    const store = makeStore();
    const outcome = await Promise.race([
      interceptFetch(store, 'https://x.y/hang', undefined, original).then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);
    expect(outcome).toBe('pending');
  });

  it('warns on unmocked requests and passes them through', async () => {
    useMocks(resolveMocks([]));
    const store = makeStore();
    expect(await (await interceptFetch(store, 'https://unmocked.test/a', undefined, original)).text()).toBe('network');
    expect(store.events.find((e) => e.type === 'warning')).toMatchObject({
      warning: { type: 'unmocked-request', message: 'Unmocked request: GET https://unmocked.test/a' },
    });
    expect(calls(store)[0]).toMatchObject({ mocked: false, status: 'ok' });
  });

  it('throws on unmocked requests in strict mode, but never for the workshop itself', async () => {
    useMocks(resolveMocks([]));
    const store = makeStore({ strictNetwork: true });
    await expect(interceptFetch(store, 'https://unmocked.test/a', undefined, original)).rejects.toThrow(/strict network mode/);
    const self = await interceptFetch(store, 'http://localhost:6006/_next/x.js', undefined, original);
    expect(await self.text()).toBe('network');
    // next/font/google downloads during compilation are Next's, not the story's.
    const font = await interceptFetch(store, 'https://fonts.googleapis.com/css2?family=Inter', undefined, original);
    expect(await font.text()).toBe('network');
  });

  it('falls through for requests it cannot parse', async () => {
    const store = makeStore();
    await interceptFetch(store, '/relative', undefined, original);
    expect(original).toHaveBeenCalledWith('/relative', undefined);
  });
});

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { router } from './core.js';
import { createHttpClient } from './http-client.js';
import { sseResponse, streamJsonLines } from './streaming.js';
import { createFetchSpy } from './test-support.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

describe('http-client', () => {
  describe('createHttpClient()', () => {
    it('returns object with configure method', () => {
      const client = createHttpClient({});
      assert.strictEqual(typeof client.configure, 'function');
    });

    it('has callable properties for route paths', () => {
      const api = router({
        users: router({ get: async () => [] }),
        posts: router({ get: async () => [] }),
      });

      const client = createHttpClient<typeof api>({});

      assert.strictEqual(typeof client.users, 'function');
      assert.strictEqual(typeof client.posts, 'function');
    });

    it('nested property chains work', () => {
      const api = router({
        inner: router({
          test: router({ get: async () => ({}) }),
        }),
      });

      const client = createHttpClient<typeof api>({});

      assert.strictEqual(typeof client.inner, 'function');
      assert.strictEqual(typeof client.inner.test, 'function');
    });

    it('deeply nested structure works (3+ levels)', () => {
      const api = router({
        l2: router({
          l3: router({
            r: router({ get: async () => ({}) }),
          }),
        }),
      });

      const client = createHttpClient<typeof api>({});

      assert.strictEqual(typeof client.l2.l3.r, 'function');
    });

    describe('fetch behavior', () => {
      it('builds path from property chain', async () => {
        const fetchMock = createFetchSpy();

        // Use any for proxy-based tests without a specific router type.
        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.outer.inner.test();

        assert.strictEqual(fetchMock.mock.calls.length, 1);
        const url = fetchMock.mock.calls[0].arguments[0];
        assert.strictEqual(url, 'http://test.com/outer/inner/test');
      });

      it('substitutes $param path params in URL', async () => {
        const fetchMock = createFetchSpy();

        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.users.$id({ path: { id: '123' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/123');
      });

      it('adds query params to URL', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test({ query: { a: 'hello', b: 42 } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(url.includes('b=42'));
      });

      it('omits undefined query params', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test({ query: { a: 'hello', b: undefined } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(!url.includes('b='));
      });

      it('works without baseUrl (relative paths)', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({ fetch: fetchMock.fetch });

        await client.api.test();

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, '/api/test');
      });

      it('sends configured headers', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          headers: { Authorization: 'Bearer token123' },
        });

        await client.test();

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer token123');
      });

      it('sends per-request headers', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test({ headers: { 'X-Custom': 'value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Custom'), 'value');
      });

      it('per-request headers override configured headers', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          headers: { 'X-Header': 'config-value' },
        });

        await client.test({ headers: { 'X-Header': 'request-value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Header'), 'request-value');
      });

      it('supports dynamic header functions', async () => {
        const fetchMock = createFetchSpy();

        let tokenValue = 'token-1';
        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          headers: {
            Authorization: () => `Bearer ${tokenValue}`,
            'X-Static': 'static-value',
          },
        });

        await client.test();
        let init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        let headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer token-1');
        assert.strictEqual(headers.get('X-Static'), 'static-value');

        tokenValue = 'token-2';
        await client.test();
        init = fetchMock.mock.calls[1].arguments[1] as RequestInit;
        headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer token-2');
      });

      it('skips dynamic headers that return null or undefined', async () => {
        const fetchMock = createFetchSpy();

        let token: string | null = null;
        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          headers: {
            Authorization: () => (token ? `Bearer ${token}` : null),
          },
        });

        await client.test();
        let init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        let headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), null);

        token = 'my-token';
        await client.test();
        init = fetchMock.mock.calls[1].arguments[1] as RequestInit;
        headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer my-token');
      });

      it('supports async header functions', async () => {
        const fetchMock = createFetchSpy();

        const getToken = async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'async-token';
        };

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          headers: {
            Authorization: async () => `Bearer ${await getToken()}`,
          },
        });

        await client.test();
        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer async-token');
      });

      it('sends credentials mode when configured', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
          credentials: 'include',
        });

        await client.test();

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.strictEqual(init.credentials, 'include');
      });

      it('sets Content-Type for POST with body', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test.$post({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Content-Type'), 'application/json');
      });

      it('sends JSON body for POST', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test.$post({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.strictEqual(init.body, JSON.stringify({ name: 'alice' }));
      });

      it('parses JSON response', async () => {
        const fetchMock = createFetchSpy(() => Response.json({ result: 'success' }));

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        const result = await client.test();
        assert.deepStrictEqual(result, { result: 'success' });
      });

      it('preserves the explicit raw response override', async () => {
        const api = router({ test: router({ get: async () => ({ result: 'success' }) }) });
        const expected = Response.json({ result: 'success' });
        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: async () => expected,
        });

        const response = await client.test({ raw: true });

        assert.strictEqual(response, expected);
      });

      it('returns SSE responses without parsing them as JSON', async () => {
        const api = router({
          events: router({
            get: async () =>
              sseResponse((send, close) => {
                send({ event: 'update', data: { count: 1 } });
                close();
              }),
          }),
        });
        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: async () => api.handler()(new Request('http://test.com/events')),
        });

        const response = await client.events();

        assert.ok(response instanceof Response);
        assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');
        assert.match(await response.text(), /event: update/);
      });

      it('returns NDJSON responses without parsing them as JSON', async () => {
        const api = router({
          export: router({
            get: async () =>
              streamJsonLines((send, close) => {
                send({ id: 1 });
                send({ id: 2 });
                close();
              }),
          }),
        });
        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: async () => api.handler()(new Request('http://test.com/export')),
        });

        const response = await client.export();

        assert.ok(response instanceof Response);
        assert.strictEqual(response.headers.get('Content-Type'), 'application/x-ndjson');
        assert.strictEqual(await response.text(), '{"id":1}\n{"id":2}\n');
      });

      it('throws on non-ok response', async () => {
        const fetchMock = createFetchSpy(() => new Response('Not Found', { status: 404 }));

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await assert.rejects(async () => client.test(), /Not Found/);
      });

      it('uses correct HTTP method via .$get(), .$post(), etc.', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test.$get();
        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');

        await client.test.$post({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[1].arguments[1] as RequestInit).method, 'POST');

        await client.test.$put({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[2].arguments[1] as RequestInit).method, 'PUT');

        await client.test.$patch({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[3].arguments[1] as RequestInit).method, 'PATCH');

        await client.test.$delete();
        assert.strictEqual((fetchMock.mock.calls[4].arguments[1] as RequestInit).method, 'DELETE');
      });

      it('lowercase method names navigate to path segments', async () => {
        const fetchMock = createFetchSpy();

        // Route structure: GET /resources/get, GET /resources/delete
        const api = router({
          resources: router({
            get: router({ get: async () => ({ action: 'get' }) }),
            delete: router({ get: async () => ({ action: 'delete' }) }),
          }),
        });

        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        // Navigate to /resources/get and execute GET.
        await client.resources.get.$get();
        assert.strictEqual(fetchMock.mock.calls[0].arguments[0], 'http://test.com/resources/get');
        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');

        // Navigate to /resources/delete and execute GET.
        await client.resources.delete.$get();
        assert.strictEqual(
          fetchMock.mock.calls[1].arguments[0],
          'http://test.com/resources/delete',
        );
        assert.strictEqual((fetchMock.mock.calls[1].arguments[1] as RequestInit).method, 'GET');
      });

      it('direct call uses GET method', async () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.test();

        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');
      });

      it('appends multiple path params in order', async () => {
        const fetchMock = createFetchSpy();

        const api = router({
          users: router({
            $userId: router({
              posts: router({
                $postId: router({
                  get: async (c) => ({ userId: c.path.userId, postId: c.path.postId }),
                }),
              }),
            }),
          }),
        });

        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.users.$userId.posts.$postId({ path: { userId: 'u1', postId: 'p2' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/u1/posts/p2');
      });

      it('encodes path params', async () => {
        const fetchMock = createFetchSpy();

        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        await client.users.$id({ path: { id: 'hello world' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/hello%20world');
      });
    });

    describe('$url builder', () => {
      it('builds an absolute URL from the property chain', () => {
        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        const url = client.media.playlist.$url();

        assert.strictEqual(url, 'http://test.com/media/playlist');
      });

      it('substitutes $param path params', () => {
        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({ baseUrl: 'http://test.com' });

        const url = client.users.$id.$url({ path: { id: '123' } });

        assert.strictEqual(url, 'http://test.com/users/123');
      });

      it('appends query params', () => {
        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        const url = client.media.playlist.$url({ query: { channel: 'classics', chunks: 1 } });

        assert.strictEqual(url, 'http://test.com/media/playlist?channel=classics&chunks=1');
      });

      it('omits undefined query params', () => {
        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        const url = client.test.$url({ query: { a: 'hello', b: undefined } });

        assert.strictEqual(url, 'http://test.com/test?a=hello');
      });

      it('returns a relative URL when no baseUrl is set', () => {
        const client: AnyClient = createHttpClient({});

        const url = client.api.test.$url({ query: { a: '1' } });

        assert.strictEqual(url, '/api/test?a=1');
      });

      it('encodes path params', () => {
        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({ baseUrl: 'http://test.com' });

        const url = client.users.$id.$url({ path: { id: 'hello world' } });

        assert.strictEqual(url, 'http://test.com/users/hello%20world');
      });

      it('does not fire a request', () => {
        const fetchMock = createFetchSpy();

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          fetch: fetchMock.fetch,
        });

        client.media.playlist.$url();

        assert.strictEqual(fetchMock.mock.calls.length, 0);
      });
    });
  });
});

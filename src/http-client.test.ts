import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './core.js';
import { createHttpClient } from './http-client.js';

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
      it('builds path from property chain', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        // Use any for proxy-based tests without a specific router type.
        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.outer.inner.test();

        assert.strictEqual(fetchMock.mock.calls.length, 1);
        const url = fetchMock.mock.calls[0].arguments[0];
        assert.strictEqual(url, 'http://test.com/outer/inner/test');
      });

      it('substitutes $param path params in URL', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({ baseUrl: 'http://test.com' });

        await client.users.$id({ path: { id: '123' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/123');
      });

      it('adds query params to URL', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test({ query: { a: 'hello', b: 42 } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(url.includes('b=42'));
      });

      it('omits undefined query params', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test({ query: { a: 'hello', b: undefined } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(!url.includes('b='));
      });

      it('works without baseUrl (relative paths)', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({});

        await client.api.test();

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, '/api/test');
      });

      it('sends configured headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          headers: { Authorization: 'Bearer token123' },
        });

        await client.test();

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer token123');
      });

      it('sends per-request headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test({ headers: { 'X-Custom': 'value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Custom'), 'value');
      });

      it('per-request headers override configured headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          headers: { 'X-Header': 'config-value' },
        });

        await client.test({ headers: { 'X-Header': 'request-value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Header'), 'request-value');
      });

      it('supports dynamic header functions', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        let tokenValue = 'token-1';
        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
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

      it('skips dynamic headers that return null or undefined', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        let token: string | null = null;
        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
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

      it('supports async header functions', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const getToken = async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'async-token';
        };

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          headers: {
            Authorization: async () => `Bearer ${await getToken()}`,
          },
        });

        await client.test();
        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer async-token');
      });

      it('sends credentials mode when configured', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({
          baseUrl: 'http://test.com',
          credentials: 'include',
        });

        await client.test();

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.strictEqual(init.credentials, 'include');
      });

      it('sets Content-Type for POST with body', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test.post({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Content-Type'), 'application/json');
      });

      it('sends JSON body for POST', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test.post({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.strictEqual(init.body, JSON.stringify({ name: 'alice' }));
      });

      it('parses JSON response', async (t) => {
        t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({ result: 'success' }))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        const result = await client.test();
        assert.deepStrictEqual(result, { result: 'success' });
      });

      it('throws on non-ok response', async (t) => {
        t.mock.method(globalThis, 'fetch', async () => new Response('Not Found', { status: 404 }));

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await assert.rejects(async () => client.test(), /Not Found/);
      });

      it('uses correct HTTP method via .get(), .post(), etc.', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test.get();
        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');

        await client.test.post({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[1].arguments[1] as RequestInit).method, 'POST');

        await client.test.put({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[2].arguments[1] as RequestInit).method, 'PUT');

        await client.test.patch({ body: {} });
        assert.strictEqual((fetchMock.mock.calls[3].arguments[1] as RequestInit).method, 'PATCH');

        await client.test.delete();
        assert.strictEqual((fetchMock.mock.calls[4].arguments[1] as RequestInit).method, 'DELETE');
      });

      it('direct call uses GET method', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const client: AnyClient = createHttpClient({ baseUrl: 'http://test.com' });

        await client.test();

        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');
      });

      it('appends multiple path params in order', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

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

        const client = createHttpClient<typeof api>({ baseUrl: 'http://test.com' });

        await client.users.$userId.posts.$postId({ path: { userId: 'u1', postId: 'p2' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/u1/posts/p2');
      });

      it('encodes path params', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({}))
        );

        const api = router({
          users: router({
            $id: router({ get: async (c) => ({ id: c.path.id }) }),
          }),
        });

        const client = createHttpClient<typeof api>({ baseUrl: 'http://test.com' });

        await client.users.$id({ path: { id: 'hello world' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/hello%20world');
      });
    });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './core.js';
import { createHttpClient } from './http-client.js';

describe('http-client', () => {
  describe('createHttpClient()', () => {
    it('returns object with configure method', () => {
      const client = createHttpClient(router('', {}));
      assert.strictEqual(typeof client.configure, 'function');
    });

    it('has methods for each route', () => {
      const client = createHttpClient(router('', {
        users: route({ method: 'get', path: '/users' }),
        posts: route({ method: 'get', path: '/posts' }),
      }));

      assert.strictEqual(typeof client.users, 'function');
      assert.strictEqual(typeof client.posts, 'function');
    });

    it('nested routers create nested client objects', () => {
      const inner = router('/inner', {
        test: route({ method: 'get', path: '/test' }),
      });
      const client = createHttpClient(router('/outer', { inner }));

      assert.strictEqual(typeof client.inner, 'object');
      assert.strictEqual(typeof client.inner.test, 'function');
    });

    it('deeply nested structure works (3+ levels)', () => {
      const l3 = router('/l3', { r: route({ method: 'get', path: '/r' }) });
      const l2 = router('/l2', { l3 });
      const l1 = router('/l1', { l2 });
      const client = createHttpClient(l1);

      assert.strictEqual(typeof client.l2.l3.r, 'function');
    });

    describe('fetch behavior', () => {
      it('builds correct path from router hierarchy', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const inner = router('/inner', { test: route({ method: 'get', path: '/test' }) });
        const client = createHttpClient(router('/outer', { inner }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.inner.test();

        assert.strictEqual(fetchMock.mock.calls.length, 1);
        const url = fetchMock.mock.calls[0].arguments[0];
        assert.strictEqual(url, 'http://test.com/outer/inner/test');
      });

      it('adds query params to URL', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          test: route({ method: 'get', path: '/test', query: { a: 'string', b: 'number' } }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.test({ query: { a: 'hello', b: 42 } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(url.includes('b=42'));
      });

      it('omits undefined query params', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          test: route({ method: 'get', path: '/test', query: { a: 'string?', b: 'string?' } }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.test({ query: { a: 'hello', b: undefined } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.includes('a=hello'));
        assert.ok(!url.includes('b='));
      });

      it('works without baseUrl (relative paths)', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('/api', { test: route({ method: 'get', path: '/test' }) }));

        await client.test();

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, '/api/test');
      });

      it('sends configured headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', { test: route({ method: 'get', path: '/test' }) }));
        client.configure({
          baseUrl: 'http://test.com',
          headers: { Authorization: 'Bearer token123' },
        });

        await client.test();

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Authorization'), 'Bearer token123');
      });

      it('sends per-request headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', { test: route({ method: 'get', path: '/test' }) }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.test({ headers: { 'X-Custom': 'value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Custom'), 'value');
      });

      it('per-request headers override configured headers', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', { test: route({ method: 'get', path: '/test' }) }));
        client.configure({
          baseUrl: 'http://test.com',
          headers: { 'X-Header': 'config-value' },
        });

        await client.test({ headers: { 'X-Header': 'request-value' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('X-Header'), 'request-value');
      });

      it('sets Content-Type for POST with body', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          test: route({ method: 'post', path: '/test', body: { name: 'string' } }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.test({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        const headers = new Headers(init.headers);
        assert.strictEqual(headers.get('Content-Type'), 'application/json');
      });

      it('sends JSON body for POST', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          test: route({ method: 'post', path: '/test', body: { name: 'string' } }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.test({ body: { name: 'alice' } });

        const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
        assert.strictEqual(init.body, JSON.stringify({ name: 'alice' }));
      });

      it('parses JSON response', async (t) => {
        t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ result: 'success' })));

        const client = createHttpClient(router('', { test: route({ method: 'get', path: '/test' }) }));
        client.configure({ baseUrl: 'http://test.com' });

        const result = await client.test();
        assert.deepStrictEqual(result, { result: 'success' });
      });

      it('throws on non-ok response', async (t) => {
        t.mock.method(globalThis, 'fetch', async () => new Response('Not Found', { status: 404 }));

        const client = createHttpClient(router('', { test: route({ method: 'get', path: '/test' }) }));
        client.configure({ baseUrl: 'http://test.com' });

        await assert.rejects(async () => client.test(), /Not Found/);
      });

      it('uses correct HTTP method', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          get: route({ method: 'get', path: '/get' }),
          post: route({ method: 'post', path: '/post' }),
          put: route({ method: 'put', path: '/put' }),
          patch: route({ method: 'patch', path: '/patch' }),
          del: route({ method: 'delete', path: '/delete' }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.get();
        assert.strictEqual((fetchMock.mock.calls[0].arguments[1] as RequestInit).method, 'GET');

        await client.post({ body: {} as never });
        assert.strictEqual((fetchMock.mock.calls[1].arguments[1] as RequestInit).method, 'POST');

        await client.put({ body: {} as never });
        assert.strictEqual((fetchMock.mock.calls[2].arguments[1] as RequestInit).method, 'PUT');

        await client.patch({ body: {} as never });
        assert.strictEqual((fetchMock.mock.calls[3].arguments[1] as RequestInit).method, 'PATCH');

        await client.del();
        assert.strictEqual((fetchMock.mock.calls[4].arguments[1] as RequestInit).method, 'DELETE');
      });

      it('substitutes single path parameter', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          getUser: route({ method: 'get', path: '/users/:id' }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.getUser({ path: { id: '123' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/123');
      });

      it('substitutes multiple path parameters', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          getPost: route({ method: 'get', path: '/users/:userId/posts/:postId' }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.getPost({ path: { userId: 'u1', postId: 'p2' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/users/u1/posts/p2');
      });

      it('substitutes path params with query params', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const client = createHttpClient(router('', {
          getUser: route({ method: 'get', path: '/users/:id', query: { include: 'string?' } }),
        }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.getUser({ path: { id: '456' }, query: { include: 'posts' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.ok(url.startsWith('http://test.com/users/456'));
        assert.ok(url.includes('include=posts'));
      });

      it('works with nested routers and path params', async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({})));

        const users = router('/users', {
          getOne: route({ method: 'get', path: '/:id' }),
        });
        const client = createHttpClient(router('/api', { users }));
        client.configure({ baseUrl: 'http://test.com' });

        await client.users.getOne({ path: { id: '789' } });

        const url = fetchMock.mock.calls[0].arguments[0] as string;
        assert.strictEqual(url, 'http://test.com/api/users/789');
      });
    });

    describe('type inference with route.ctx() and route.env()', () => {
      it('infers return type correctly with route.ctx<>()', async (t) => {
        interface AuthContext {
          user: { id: string; name: string };
        }

        t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({ greeting: 'Hello, Alice' }))
        );

        const api = router('/api', {
          profile: route.ctx<AuthContext>()({
            method: 'get',
            path: '/profile',
            handler: async (c) => ({ greeting: `Hello, ${c.user.name}` }),
          }),
        });

        const client = createHttpClient(api);
        client.configure({ baseUrl: 'http://test.com' });

        const result = await client.profile();

        // If types are broken, result would be `never` or `unknown`.
        // This assertion verifies the return type is correctly inferred.
        assert.strictEqual(result.greeting, 'Hello, Alice');
      });

      it('infers return type correctly with route.ctx<>() for env', async (t) => {
        interface AppContext {
          env: { API_KEY: string };
        }

        t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({ data: 'secret' }))
        );

        const api = router('/api', {
          secret: route.ctx<AppContext>()({
            method: 'get',
            path: '/secret',
            handler: async (c) => ({ data: c.env.API_KEY }),
          }),
        });

        const client = createHttpClient(api);
        client.configure({ baseUrl: 'http://test.com' });

        const result = await client.secret();
        assert.strictEqual(result.data, 'secret');
      });

      it('infers return type correctly with route.ctx<>() for env and middleware props', async (t) => {
        interface AppContext {
          env: { DB: { query: () => string } };
          userId: string;
        }

        t.mock.method(globalThis, 'fetch', async () =>
          new Response(JSON.stringify({ userId: 'u123', dbResult: 'data' }))
        );

        const api = router('/api', {
          userData: route.ctx<AppContext>()({
            method: 'get',
            path: '/user-data',
            handler: async (c) => ({
              userId: c.userId,
              dbResult: c.env.DB.query(),
            }),
          }),
        });

        const client = createHttpClient(api);
        client.configure({ baseUrl: 'http://test.com' });

        const result = await client.userData();
        assert.strictEqual(result.userId, 'u123');
        assert.strictEqual(result.dbResult, 'data');
      });
    });

  });
});

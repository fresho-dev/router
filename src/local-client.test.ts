import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './core.js';
import { createLocalClient } from './local-client.js';

describe('local-client', () => {
  describe('localClient()', () => {
    it('returns object with configure method', () => {
      const client = createLocalClient(router('', {}));
      assert.strictEqual(typeof client.configure, 'function');
    });

    it('has methods for each route', () => {
      const client = createLocalClient(router('', {
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
      const client = createLocalClient(router('/outer', { inner }));

      assert.strictEqual(typeof client.inner, 'object');
      assert.strictEqual(typeof client.inner.test, 'function');
    });

    it('calls handler directly and returns parsed JSON', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async () => Response.json({ message: 'hello' }),
        }),
      }));

      const result = await client.test();
      assert.deepStrictEqual(result, { message: 'hello' });
    });

    it('passes query params to handler', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          query: { name: 'string' },
          handler: async (c) => Response.json({ name: c.params.query.name }),
        }),
      }));

      const result = await client.test({ query: { name: 'alice' } });
      assert.deepStrictEqual(result, { name: 'alice' });
    });

    it('passes body to handler', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'post',
          path: '/test',
          body: { name: 'string' },
          handler: async (c) => Response.json({ name: c.params.body.name }),
        }),
      }));

      const result = await client.test({ body: { name: 'bob' } });
      assert.deepStrictEqual(result, { name: 'bob' });
    });

    it('validates query params and throws on error', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          query: { count: 'number' },
          handler: async () => Response.json({}),
        }),
      }));

      await assert.rejects(
        async () => client.test({ query: { count: 'not-a-number' as unknown as number } }),
        /Invalid query parameters/
      );
    });

    it('validates body and throws on error', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'post',
          path: '/test',
          body: { name: 'string' },
          handler: async () => Response.json({}),
        }),
      }));

      await assert.rejects(async () => client.test({ body: {} as never }), /Invalid request body/);
    });

    it('passes env from options', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async (c) => Response.json({ hasEnv: c.env !== undefined }),
        }),
      }));

      const result = await client.test({ env: { DB: 'test' } });
      assert.deepStrictEqual(result, { hasEnv: true });
    });

    it('passes ctx from options', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async (c) => Response.json({ hasCtx: c.executionCtx !== undefined }),
        }),
      }));

      const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} };
      const result = await client.test({ ctx: mockCtx });
      assert.deepStrictEqual(result, { hasCtx: true });
    });

    it('uses configured env/ctx as defaults', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async (c) =>
            Response.json({ hasEnv: c.env !== undefined, hasCtx: c.executionCtx !== undefined }),
        }),
      }));

      const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} };
      client.configure({ env: { DB: 'test' }, ctx: mockCtx });

      const result = await client.test();
      assert.deepStrictEqual(result, { hasEnv: true, hasCtx: true });
    });

    it('per-call options override configured defaults', async () => {
      const client = createLocalClient(router('', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async (c) => Response.json({ db: (c.env as Record<string, string>).DB }),
        }),
      }));

      client.configure({ env: { DB: 'default' } });
      const result = await client.test({ env: { DB: 'override' } });
      assert.deepStrictEqual(result, { db: 'override' });
    });

    it('returns empty object when no handler defined', async () => {
      const client = createLocalClient(router('', {
        test: route({ method: 'get', path: '/test' }),
      }));

      const result = await client.test();
      assert.deepStrictEqual(result, {});
    });

    it('creates synthetic request with correct URL', async () => {
      let capturedUrl = '';
      const client = createLocalClient(router('/api', {
        test: route({
          method: 'get',
          path: '/test',
          query: { id: 'string' },
          handler: async (c) => {
            capturedUrl = c.request.url;
            return Response.json({});
          },
        }),
      }));

      await client.test({ query: { id: '123' } });
      assert.ok(capturedUrl.includes('/api/test'));
      assert.ok(capturedUrl.includes('id=123'));
    });

    it('creates synthetic request with correct method', async () => {
      let capturedMethod = '';
      const client = createLocalClient(router('', {
        test: route({
          method: 'post',
          path: '/test',
          handler: async (c) => {
            capturedMethod = c.request.method;
            return Response.json({});
          },
        }),
      }));

      await client.test();
      assert.strictEqual(capturedMethod, 'POST');
    });

    it('passes path params to handler', async () => {
      const api = router('/api', {
        users: router('/users', {
          get: route({
            method: 'get',
            path: '/:id',
            handler: async (c) => ({ userId: c.params.path.id }),
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.users.get({ path: { id: '123' } }) as { userId: string };
      assert.strictEqual(result.userId, '123');
    });

    it('passes multiple path params to handler', async () => {
      const api = router('/api', {
        posts: route({
          method: 'get',
          path: '/users/:userId/posts/:postId',
          handler: async (c) => ({
            userId: c.params.path.userId,
            postId: c.params.path.postId,
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.posts({ path: { userId: 'u1', postId: 'p42' } }) as { userId: string; postId: string };
      assert.strictEqual(result.userId, 'u1');
      assert.strictEqual(result.postId, 'p42');
    });

    it('throws when missing required path param', async () => {
      const api = router('/api', {
        users: route({
          method: 'get',
          path: '/users/:id',
          handler: async () => ({}),
        }),
      });

      const client = createLocalClient(api);
      await assert.rejects(
        () => client.users({ path: {} } as any),
        /Missing path parameter: id/
      );
    });

    it('substitutes path params into synthetic request URL', async () => {
      let capturedUrl = '';
      const api = router('/api', {
        users: route({
          method: 'get',
          path: '/users/:id/profile' as const,
          handler: async (c) => {
            capturedUrl = c.request.url;
            return {};
          },
        }),
      });

      const client = createLocalClient(api);
      await client.users({ path: { id: 'abc123' } });
      assert.ok(capturedUrl.includes('/api/users/abc123/profile'));
    });

    it('works with path params and query params together', async () => {
      const api = router('/api', {
        posts: route({
          method: 'get',
          path: '/users/:userId/posts' as const,
          query: { limit: 'number?' },
          handler: async (c) => ({
            userId: c.params.path.userId,
            limit: c.params.query.limit ?? 10,
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.posts({ path: { userId: 'u1' }, query: { limit: 5 } }) as { userId: string; limit: number };
      assert.strictEqual(result.userId, 'u1');
      assert.strictEqual(result.limit, 5);
    });
  });

  // ===========================================================================
  // Type Inference Tests (nested routers)
  // ===========================================================================
  describe('type inference in nested routers', () => {
    it('infers number type correctly in nested router handler', async () => {
      const api = router('/api', {
        users: router('/users', {
          list: route({
            method: 'get',
            path: '',
            query: { limit: 'number' },
            handler: async (c) => {
              const items = Array.from({ length: c.params.query.limit }, (_, i) => i);
              return { items };
            },
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.users.list({ query: { limit: 3 } }) as { items: number[] };
      assert.deepStrictEqual(result.items, [0, 1, 2]);
    });

    it('infers optional number type with undefined in nested router', async () => {
      const api = router('/api', {
        users: router('/users', {
          list: route({
            method: 'get',
            path: '',
            query: { limit: 'number?' },
            handler: async (c) => {
              const limit = c.params.query.limit ?? 10;
              const items = Array.from({ length: limit }, (_, i) => i);
              return { items, hadDefault: c.params.query.limit === undefined };
            },
          }),
        }),
      });

      const client = createLocalClient(api);

      const withParam = await client.users.list({ query: { limit: 3 } }) as { items: number[]; hadDefault: boolean };
      assert.deepStrictEqual(withParam.items, [0, 1, 2]);
      assert.strictEqual(withParam.hadDefault, false);

      const withoutParam = await client.users.list() as { items: number[]; hadDefault: boolean };
      assert.strictEqual(withoutParam.items.length, 10);
      assert.strictEqual(withoutParam.hadDefault, true);
    });

    it('infers string type correctly in nested router handler', async () => {
      const api = router('/api', {
        items: router('/items', {
          search: route({
            method: 'get',
            path: '/search',
            query: { q: 'string' },
            handler: async (c) => {
              const upper = c.params.query.q.toUpperCase();
              const len = c.params.query.q.length;
              return { upper, len };
            },
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.items.search({ query: { q: 'hello' } }) as { upper: string; len: number };
      assert.strictEqual(result.upper, 'HELLO');
      assert.strictEqual(result.len, 5);
    });

    it('infers boolean type correctly in nested router handler', async () => {
      const api = router('/api', {
        config: router('/config', {
          get: route({
            method: 'get',
            path: '',
            query: { enabled: 'boolean' },
            handler: async (c) => {
              const status = c.params.query.enabled ? 'on' : 'off';
              return { status };
            },
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.config.get({ query: { enabled: true } }) as { status: string };
      assert.strictEqual(result.status, 'on');
    });

    it('infers body types correctly in deeply nested router', async () => {
      const api = router('/api', {
        v1: router('/v1', {
          users: router('/users', {
            create: route({
              method: 'post',
              path: '',
              body: { name: 'string', age: 'number' },
              handler: async (c) => {
                const greeting = `Hello ${c.params.body.name}`;
                const nextAge = c.params.body.age + 1;
                return { greeting, nextAge };
              },
            }),
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.v1.users.create({ body: { name: 'Alice', age: 30 } }) as { greeting: string; nextAge: number };
      assert.strictEqual(result.greeting, 'Hello Alice');
      assert.strictEqual(result.nextAge, 31);
    });

    it('infers mixed query and body types in nested router', async () => {
      const api = router('/api', {
        data: router('/data', {
          process: route({
            method: 'post',
            path: '/process',
            query: { multiplier: 'number' },
            body: { values: 'string' },
            handler: async (c) => {
              const repeated = c.params.body.values.repeat(c.params.query.multiplier);
              return { repeated };
            },
          }),
        }),
      });

      const client = createLocalClient(api);
      const result = await client.data.process({
        query: { multiplier: 3 },
        body: { values: 'ab' },
      }) as { repeated: string };
      assert.strictEqual(result.repeated, 'ababab');
    });
  });
});

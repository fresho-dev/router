import assert from 'node:assert';
import { describe, it } from 'node:test';
import { route, router } from './core.js';
import { createLocalClient } from './local-client.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

describe('local-client', () => {
  describe('localClient()', () => {
    it('returns object with configure method', () => {
      const client: AnyClient = createLocalClient(router({}));
      assert.strictEqual(typeof client.configure, 'function');
    });

    it('has callable properties for each route', () => {
      const client: AnyClient = createLocalClient(
        router({
          users: router({ get: async () => [] }),
          posts: router({ get: async () => [] }),
        }),
      );

      assert.strictEqual(typeof client.users, 'function');
      assert.strictEqual(typeof client.posts, 'function');
    });

    it('nested routers create nested client objects', () => {
      const inner = router({
        test: router({ get: async () => ({}) }),
      });
      const client: AnyClient = createLocalClient(router({ outer: router({ inner }) }));

      assert.strictEqual(typeof client.outer.inner, 'function');
      assert.strictEqual(typeof client.outer.inner.test, 'function');
    });

    it('calls handler directly and returns parsed JSON', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async () => Response.json({ message: 'hello' }),
          }),
        }),
      );

      const result = await client.test();
      assert.deepStrictEqual(result, { message: 'hello' });
    });

    it('direct call invokes handler (GET default)', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async () => ({ message: 'hello' }),
          }),
        }),
      );

      const result = await client.test();
      assert.deepStrictEqual(result, { message: 'hello' });
    });

    it('.$get() also invokes handler', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async () => ({ message: 'hello' }),
          }),
        }),
      );

      const result = await client.test.$get();
      assert.deepStrictEqual(result, { message: 'hello' });
    });

    it('.$post() invokes handler', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            post: route({
              body: { name: 'string' },
              handler: async (c) => ({ name: c.body.name }),
            }),
          }),
        }),
      );

      const result = await client.test.$post({ body: { name: 'bob' } });
      assert.deepStrictEqual(result, { name: 'bob' });
    });

    it('passes query params to handler', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: route({
              query: { name: 'string' },
              handler: async (c) => Response.json({ name: c.query.name }),
            }),
          }),
        }),
      );

      const result = await client.test({ query: { name: 'alice' } });
      assert.deepStrictEqual(result, { name: 'alice' });
    });

    it('passes body to handler', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            post: route({
              body: { name: 'string' },
              handler: async (c) => Response.json({ name: c.body.name }),
            }),
          }),
        }),
      );

      const result = await client.test.$post({ body: { name: 'bob' } });
      assert.deepStrictEqual(result, { name: 'bob' });
    });

    it('validates query params and throws on error', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: route({
              query: { count: 'number' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      await assert.rejects(
        async () => client.test({ query: { count: 'not-a-number' as unknown as number } }),
        /Invalid query parameters/,
      );
    });

    it('validates body and throws on error', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            post: route({
              body: { name: 'string' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      await assert.rejects(
        async () => client.test.$post({ body: {} as never }),
        /Invalid request body/,
      );
    });

    it('passes env from options', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async (c) => Response.json({ hasEnv: c.env !== undefined }),
          }),
        }),
      );

      const result = await client.test({ env: { DB: 'test' } });
      assert.deepStrictEqual(result, { hasEnv: true });
    });

    it('passes ctx from options', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async (c) => Response.json({ hasCtx: c.executionCtx !== undefined }),
          }),
        }),
      );

      const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} };
      const result = await client.test({ ctx: mockCtx });
      assert.deepStrictEqual(result, { hasCtx: true });
    });

    it('uses configured env/ctx as defaults', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async (c) =>
              Response.json({ hasEnv: c.env !== undefined, hasCtx: c.executionCtx !== undefined }),
          }),
        }),
      );

      const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} };
      client.configure({ env: { DB: 'test' }, ctx: mockCtx });

      const result = await client.test();
      assert.deepStrictEqual(result, { hasEnv: true, hasCtx: true });
    });

    it('per-call options override configured defaults', async () => {
      interface AppContext {
        env: { DB: string };
      }
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: route.ctx<AppContext>()({
              handler: async (c) => Response.json({ db: c.env.DB }),
            }),
          }),
        }),
      );

      client.configure({ env: { DB: 'default' } });
      const result = await client.test({ env: { DB: 'override' } });
      assert.deepStrictEqual(result, { db: 'override' });
    });

    it('returns empty object when no handler defined', async () => {
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            get: async () => ({}),
          }),
        }),
      );

      const result = await client.test();
      assert.deepStrictEqual(result, {});
    });

    it('creates synthetic request with correct URL', async () => {
      let capturedUrl = '';
      const client: AnyClient = createLocalClient(
        router({
          api: router({
            test: router({
              get: route({
                query: { id: 'string' },
                handler: async (c) => {
                  capturedUrl = c.request.url;
                  return Response.json({});
                },
              }),
            }),
          }),
        }),
      );

      await client.api.test({ query: { id: '123' } });
      assert.ok(capturedUrl.includes('/api/test'));
      assert.ok(capturedUrl.includes('id=123'));
    });

    it('creates synthetic request with correct method', async () => {
      let capturedMethod = '';
      const client: AnyClient = createLocalClient(
        router({
          test: router({
            post: async (c) => {
              capturedMethod = c.request.method;
              return Response.json({});
            },
          }),
        }),
      );

      await client.test.$post();
      assert.strictEqual(capturedMethod, 'POST');
    });

    it('passes path params to handler', async () => {
      const api = router({
        users: router({
          $id: router({
            get: async (c) => ({ userId: c.path.id }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.users.$id({ path: { id: '123' } })) as { userId: string };
      assert.strictEqual(result.userId, '123');
    });

    it('passes multiple path params to handler', async () => {
      const api = router({
        users: router({
          $userId: router({
            posts: router({
              $postId: router({
                get: async (c) => ({
                  userId: c.path.userId,
                  postId: c.path.postId,
                }),
              }),
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.users.$userId.posts.$postId({
        path: { userId: 'u1', postId: 'p42' },
      })) as {
        userId: string;
        postId: string;
      };
      assert.strictEqual(result.userId, 'u1');
      assert.strictEqual(result.postId, 'p42');
    });

    it('throws when missing required path param', async () => {
      const api = router({
        users: router({
          $id: router({
            get: async () => ({}),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      await assert.rejects(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => client.users.$id({ path: {} } as any),
        /Missing path parameter: id/,
      );
    });

    it('substitutes path params into synthetic request URL', async () => {
      let capturedUrl = '';
      const api = router({
        users: router({
          $id: router({
            profile: router({
              get: async (c) => {
                capturedUrl = c.request.url;
                return {};
              },
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      await client.users.$id.profile({ path: { id: 'abc123' } });
      assert.ok(capturedUrl.includes('/users/abc123/profile'));
    });

    it('works with path params and query params together', async () => {
      interface PathContext {
        path: { userId: string };
      }

      const api = router({
        users: router({
          $userId: router({
            posts: router({
              get: route.ctx<PathContext>()({
                query: { limit: 'number?' },
                handler: async (c) => ({
                  userId: c.path.userId,
                  limit: c.query.limit ?? 10,
                }),
              }),
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.users.$userId.posts({
        path: { userId: 'u1' },
        query: { limit: 5 },
      })) as {
        userId: string;
        limit: number;
      };
      assert.strictEqual(result.userId, 'u1');
      assert.strictEqual(result.limit, 5);
    });
  });

  describe('type inference in nested routers', () => {
    it('infers number type correctly in nested router handler', async () => {
      const api = router({
        users: router({
          get: route({
            query: { limit: 'number' },
            handler: async (c) => {
              const items = Array.from({ length: c.query.limit }, (_, i) => i);
              return { items };
            },
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.users({ query: { limit: 3 } })) as { items: number[] };
      assert.deepStrictEqual(result.items, [0, 1, 2]);
    });

    it('infers optional number type with undefined in nested router', async () => {
      const api = router({
        users: router({
          get: route({
            query: { limit: 'number?' },
            handler: async (c) => {
              const limit = c.query.limit ?? 10;
              const items = Array.from({ length: limit }, (_, i) => i);
              return { items, hadDefault: c.query.limit === undefined };
            },
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);

      const withParam = (await client.users({ query: { limit: 3 } })) as {
        items: number[];
        hadDefault: boolean;
      };
      assert.deepStrictEqual(withParam.items, [0, 1, 2]);
      assert.strictEqual(withParam.hadDefault, false);

      const withoutParam = (await client.users()) as { items: number[]; hadDefault: boolean };
      assert.strictEqual(withoutParam.items.length, 10);
      assert.strictEqual(withoutParam.hadDefault, true);
    });

    it('infers string type correctly in nested router handler', async () => {
      const api = router({
        items: router({
          search: router({
            get: route({
              query: { q: 'string' },
              handler: async (c) => {
                const upper = c.query.q.toUpperCase();
                const len = c.query.q.length;
                return { upper, len };
              },
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.items.search({ query: { q: 'hello' } })) as {
        upper: string;
        len: number;
      };
      assert.strictEqual(result.upper, 'HELLO');
      assert.strictEqual(result.len, 5);
    });

    it('infers boolean type correctly in nested router handler', async () => {
      const api = router({
        config: router({
          get: route({
            query: { enabled: 'boolean' },
            handler: async (c) => {
              const status = c.query.enabled ? 'on' : 'off';
              return { status };
            },
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.config({ query: { enabled: true } })) as { status: string };
      assert.strictEqual(result.status, 'on');
    });

    it('infers body types correctly in deeply nested router', async () => {
      const api = router({
        v1: router({
          users: router({
            post: route({
              body: { name: 'string', age: 'number' },
              handler: async (c) => {
                const greeting = `Hello ${c.body.name}`;
                const nextAge = c.body.age + 1;
                return { greeting, nextAge };
              },
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.v1.users.$post({
        body: { name: 'Alice', age: 30 },
      })) as { greeting: string; nextAge: number };
      assert.strictEqual(result.greeting, 'Hello Alice');
      assert.strictEqual(result.nextAge, 31);
    });

    it('infers mixed query and body types in nested router', async () => {
      const api = router({
        data: router({
          process: router({
            post: route({
              query: { multiplier: 'number' },
              body: { values: 'string' },
              handler: async (c) => {
                const repeated = c.body.values.repeat(c.query.multiplier);
                return { repeated };
              },
            }),
          }),
        }),
      });

      const client: AnyClient = createLocalClient(api);
      const result = (await client.data.process.$post({
        query: { multiplier: 3 },
        body: { values: 'ab' },
      })) as { repeated: string };
      assert.strictEqual(result.repeated, 'ababab');
    });
  });
});

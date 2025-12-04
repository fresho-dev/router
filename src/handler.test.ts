import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createHandler } from './handler.js';
import { route, router } from './index.js';
import type { MiddlewareContext, MiddlewareNext } from './middleware.js';

describe('router.handler()', () => {
  it('returns a fetch handler equivalent to createHandler', async () => {
    const api = router({
      hello: router({
        get: async () => ({ message: 'world' }),
      }),
    });

    const handler = api.handler();
    const res = await handler(new Request('http://localhost/hello'));

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { message: 'world' });
  });

  it('works with nested routers', async () => {
    const api = router({
      api: router({
        v1: router({
          users: router({
            get: async () => ({ users: [] }),
          }),
        }),
      }),
    });

    const handler = api.handler();
    const res = await handler(new Request('http://localhost/api/v1/users'));

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { users: [] });
  });

  it('works with middleware', async () => {
    const addHeader = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
      const response = await next();
      response.headers.set('X-Custom', 'test');
      return response;
    };

    const api = router(
      {
        test: router({
          get: async () => ({ ok: true }),
        }),
      },
      addHeader,
    );

    const handler = api.handler();
    const res = await handler(new Request('http://localhost/test'));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('X-Custom'), 'test');
  });

  it('passes env and ctx to handlers', async () => {
    const api = router({
      test: router({
        get: async (c) => ({
          hasEnv: c.env !== undefined,
          envValue: (c.env as { KEY: string }).KEY,
        }),
      }),
    });

    const handler = api.handler();
    const res = await handler(
      new Request('http://localhost/test'),
      { KEY: 'secret' },
      { waitUntil: () => {}, passThroughOnException: () => {} },
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { hasEnv: true, envValue: 'secret' });
  });
});

describe('standalone router', () => {
  describe('createHandler()', () => {
    it('returns 404 for unmatched routes', async () => {
      const handler = createHandler(router({}));
      const res = await handler(new Request('http://localhost/unknown'));
      assert.strictEqual(res.status, 404);
    });

    it('matches GET routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: async () => Response.json({ ok: true }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { ok: true });
    });

    it('matches POST routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            post: async () => Response.json({ method: 'post' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'POST' }));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { method: 'post' });
    });

    it('matches PUT routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            put: async () => Response.json({ method: 'put' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'PUT' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches PATCH routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            patch: async () => Response.json({ method: 'patch' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'PATCH' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches DELETE routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            delete: async () => Response.json({ method: 'delete' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'DELETE' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches OPTIONS routes', async () => {
      const handler = createHandler(
        router({
          test: router({
            options: async () => Response.json({ method: 'options' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'OPTIONS' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches HEAD requests to GET routes per RFC 9110', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: async () => Response.json({ data: 'hello' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'HEAD' }));
      assert.strictEqual(res.status, 200);
      const body = await res.text();
      assert.strictEqual(body, '');
    });

    it('returns 404 for HEAD when no GET route exists', async () => {
      const handler = createHandler(
        router({
          test: router({
            post: async () => Response.json({ ok: true }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'HEAD' }));
      assert.strictEqual(res.status, 404);
    });

    it('prefers explicit HEAD route over GET fallback', async () => {
      const handler = createHandler(
        router({
          test: router({
            head: async () => new Response(null, { status: 204 }),
            get: async () => Response.json({ data: 'from get' }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test', { method: 'HEAD' }));
      assert.strictEqual(res.status, 204);
    });

    it('allows HTTP method names as path segments when they contain routers', async () => {
      // This tests that `get: router(...)` is treated as a path segment, not a method handler.
      // Regression test for: property names like 'get', 'post', etc. should be path segments
      // when their value is a router, not a route or function.
      const handler = createHandler(
        router({
          resources: router({
            get: router({ get: async () => Response.json({ action: 'get resource' }) }),
            set: router({ get: async () => Response.json({ action: 'set resource' }) }),
            delete: router({ get: async () => Response.json({ action: 'delete resource' }) }),
          }),
        }),
      );

      // GET /resources/get should match the nested GET handler.
      const res1 = await handler(new Request('http://localhost/resources/get'));
      assert.strictEqual(res1.status, 200);
      assert.deepStrictEqual(await res1.json(), { action: 'get resource' });

      // GET /resources/set should match.
      const res2 = await handler(new Request('http://localhost/resources/set'));
      assert.strictEqual(res2.status, 200);
      assert.deepStrictEqual(await res2.json(), { action: 'set resource' });

      // GET /resources/delete should match.
      const res3 = await handler(new Request('http://localhost/resources/delete'));
      assert.strictEqual(res3.status, 200);
      assert.deepStrictEqual(await res3.json(), { action: 'delete resource' });

      // GET /resources should return 404 (no handler at that level).
      const res4 = await handler(new Request('http://localhost/resources'));
      assert.strictEqual(res4.status, 404);
    });

    it('uses property names as path segments', async () => {
      const handler = createHandler(
        router({
          api: router({
            test: router({
              get: async () => Response.json({ ok: true }),
            }),
          }),
        }),
      );

      const matched = await handler(new Request('http://localhost/api/test'));
      assert.strictEqual(matched.status, 200);

      const notMatched = await handler(new Request('http://localhost/test'));
      assert.strictEqual(notMatched.status, 404);
    });

    it('combines nested router paths', async () => {
      const inner = router({
        test: router({
          get: async () => Response.json({ nested: true }),
        }),
      });

      const handler = createHandler(router({ outer: router({ inner }) }));

      const res = await handler(new Request('http://localhost/outer/inner/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { nested: true });
    });

    it('handles deeply nested routers (3+ levels)', async () => {
      const l3 = router({
        r: router({
          get: async () => Response.json({ level: 3 }),
        }),
      });
      const l2 = router({ l3 });
      const l1 = router({ l2 });

      const handler = createHandler(router({ l1 }));

      const res = await handler(new Request('http://localhost/l1/l2/l3/r'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { level: 3 });
    });

    it('multiple routes on same path with different methods', async () => {
      const handler = createHandler(
        router({
          users: router({
            get: async () => Response.json({ action: 'list' }),
            post: async () => Response.json({ action: 'create' }),
          }),
        }),
      );

      const getRes = await handler(new Request('http://localhost/users'));
      assert.deepStrictEqual(await getRes.json(), { action: 'list' });

      const postRes = await handler(new Request('http://localhost/users', { method: 'POST' }));
      assert.deepStrictEqual(await postRes.json(), { action: 'create' });
    });
  });

  describe('query validation', () => {
    it('passes valid required string', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { name: 'string' },
              handler: async (c) => Response.json({ name: c.query.name }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?name=alice'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid required number (coerces from string)', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { count: 'number' },
              handler: async (c) => Response.json({ count: c.query.count }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?count=42'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { count: 42 });
    });

    it('passes valid required boolean (coerces from string)', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { active: 'boolean' },
              handler: async (c) => Response.json({ active: c.query.active }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?active=true'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { active: true });
    });

    it('passes optional params when present', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { name: 'string?' },
              handler: async (c) => Response.json({ name: c.query.name }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?name=bob'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'bob' });
    });

    it('passes when optional params are missing', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { name: 'string?' },
              handler: async (c) => Response.json({ query: c.query }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('fails when required param is missing', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { name: 'string' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.ok(body.error.includes('Invalid'));
    });

    it('fails when number param is not numeric', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { count: 'number' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?count=notanumber'));
      assert.strictEqual(res.status, 400);
    });
  });

  describe('body validation', () => {
    it('passes valid body for POST', async () => {
      const handler = createHandler(
        router({
          test: router({
            post: route({
              body: { name: 'string' },
              handler: async (c) => Response.json({ name: c.body.name }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'alice' }),
        }),
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid body for PUT', async () => {
      const handler = createHandler(
        router({
          test: router({
            put: route({
              body: { name: 'string' },
              handler: async () => Response.json({ ok: true }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'bob' }),
        }),
      );
      assert.strictEqual(res.status, 200);
    });

    it('passes valid body for PATCH', async () => {
      const handler = createHandler(
        router({
          test: router({
            patch: route({
              body: { name: 'string?' },
              handler: async () => Response.json({ ok: true }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
      assert.strictEqual(res.status, 200);
    });

    it('fails when required body field is missing', async () => {
      const handler = createHandler(
        router({
          test: router({
            post: route({
              body: { name: 'string', email: 'string' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'alice' }),
        }),
      );
      assert.strictEqual(res.status, 400);
    });

    it('returns error with details', async () => {
      const handler = createHandler(
        router({
          test: router({
            post: route({
              body: { count: 'number' },
              handler: async () => Response.json({}),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 'not a number' }),
        }),
      );
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string; details: object };
      assert.ok(body.error);
      assert.ok(body.details);
    });
  });

  describe('edge cases', () => {
    it('route with no query or body schema', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: async () => Response.json({ ok: true }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
    });

    it('route with empty query schema', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: {},
              handler: async (c) => Response.json({ query: c.query }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test?ignored=param'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('special characters in query values', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { q: 'string' },
              handler: async (c) => Response.json({ q: c.query.q }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request(`http://localhost/test?q=${encodeURIComponent('hello world & more')}`),
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { q: 'hello world & more' });
    });

    it('unicode in query params', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { name: 'string' },
              handler: async (c) => Response.json({ name: c.query.name }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request(`http://localhost/test?name=${encodeURIComponent('日本語')}`),
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: '日本語' });
    });

    it('route without handler still validates', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: route({
              query: { required: 'string' },
              handler: async () => ({}),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 400);
    });

    it('route without handler returns empty JSON on success', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: async () => ({}),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {});
    });

    it('does not call handler when validation fails', async () => {
      let handlerCalled = false;
      const handler = createHandler(
        router({
          r: router({
            get: route({
              query: { required: 'string' },
              handler: async () => {
                handlerCalled = true;
                return Response.json({});
              },
            }),
          }),
        }),
      );

      await handler(new Request('http://localhost/r'));
      assert.strictEqual(handlerCalled, false);
    });

    it('passes env and ctx to handler via context', async () => {
      const handler = createHandler(
        router({
          test: router({
            get: async (c) =>
              Response.json({
                hasEnv: c.env !== undefined,
                hasCtx: c.executionCtx !== undefined,
              }),
          }),
        }),
      );

      const mockEnv = { DB: 'test' };
      const mockCtx = { waitUntil: () => {}, passThroughOnException: () => {} };

      const res = await handler(new Request('http://localhost/test'), mockEnv, mockCtx);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { hasEnv: true, hasCtx: true });
    });
  });

  describe('path parameters', () => {
    it('extracts single path parameter', async () => {
      const handler = createHandler(
        router({
          books: router({
            $id: router({
              get: async (c) => Response.json({ bookId: c.path.id }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/books/123'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: '123' });
    });

    it('extracts multiple path parameters', async () => {
      const handler = createHandler(
        router({
          books: router({
            $bookId: router({
              chapters: router({
                $chapterId: router({
                  get: async (c) =>
                    Response.json({ bookId: c.path.bookId, chapterId: c.path.chapterId }),
                }),
              }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/books/abc/chapters/42'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: 'abc', chapterId: '42' });
    });

    it('path params work alongside query params', async () => {
      interface BookContext {
        path: { id: string };
      }

      const handler = createHandler(
        router({
          books: router({
            $id: router({
              get: route.ctx<BookContext>()({
                query: { format: 'string?' },
                handler: async (c) =>
                  Response.json({ bookId: c.path.id, format: c.query.format ?? 'json' }),
              }),
            }),
          }),
        }),
      );

      const res = await handler(new Request('http://localhost/books/123?format=xml'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: '123', format: 'xml' });
    });

    it('encodes path params in URL', async () => {
      const handler = createHandler(
        router({
          users: router({
            $id: router({
              get: async (c) => Response.json({ userId: c.path.id }),
            }),
          }),
        }),
      );

      const res = await handler(
        new Request(`http://localhost/users/${encodeURIComponent('user@example.com')}`),
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { userId: 'user@example.com' });
    });
  });

  describe('middleware to handler context passing', () => {
    interface UserContext {
      user: { id: string; name: string };
    }

    interface PermissionsContext {
      user: { id: string };
      permissions: string[];
    }

    interface DbContext {
      dbConnection: string;
    }

    it('passes middleware-added properties to handler via context (typed)', async () => {
      const authMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.user = { id: '123', name: 'Alice' };
        return next();
      };

      const handler = createHandler(
        router(
          {
            profile: router({
              get: route.ctx<UserContext>()({
                handler: async (c) => {
                  return Response.json({ userId: c.user.id, userName: c.user.name });
                },
              }),
            }),
          },
          authMiddleware,
        ),
      );

      const res = await handler(new Request('http://localhost/profile'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { userId: '123', userName: 'Alice' });
    });

    it('passes multiple middleware properties to handler (typed)', async () => {
      const authMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.user = { id: '123' };
        return next();
      };

      const permissionsMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.permissions = ['read', 'write'];
        return next();
      };

      const handler = createHandler(
        router(
          {
            data: router({
              get: route.ctx<PermissionsContext>()({
                handler: async (c) => {
                  return Response.json({
                    userId: c.user.id,
                    canRead: c.permissions.includes('read'),
                    canWrite: c.permissions.includes('write'),
                  });
                },
              }),
            }),
          },
          authMiddleware,
          permissionsMiddleware,
        ),
      );

      const res = await handler(new Request('http://localhost/data'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {
        userId: '123',
        canRead: true,
        canWrite: true,
      });
    });

    it('context includes env alongside middleware properties (typed)', async () => {
      const dbMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.dbConnection = 'connected';
        return next();
      };

      const handler = createHandler(
        router(
          {
            status: router({
              get: route.ctx<DbContext>()({
                handler: async (c) => {
                  const env = c.env as { API_KEY: string };
                  return Response.json({
                    apiKey: env.API_KEY,
                    dbStatus: c.dbConnection,
                  });
                },
              }),
            }),
          },
          dbMiddleware,
        ),
      );

      const res = await handler(new Request('http://localhost/status'), { API_KEY: 'secret123' });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {
        apiKey: 'secret123',
        dbStatus: 'connected',
      });
    });

    it('supports chained context types with route.ctx<A>().ctx<B>()', async () => {
      interface EnvContext {
        env: { API_KEY: string };
      }

      interface AuthContext {
        user: { id: string; role: string };
      }

      interface DbContext {
        dbConnection: string;
      }

      const authMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.user = { id: 'user-123', role: 'admin' };
        return next();
      };

      const dbMiddleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
        ctx.dbConnection = 'connected';
        return next();
      };

      const handler = createHandler(
        router(
          {
            data: router({
              get: route.ctx<EnvContext>().ctx<AuthContext>().ctx<DbContext>()({
                handler: async (c) => {
                  return Response.json({
                    apiKey: c.env.API_KEY,
                    userId: c.user.id,
                    userRole: c.user.role,
                    dbStatus: c.dbConnection,
                  });
                },
              }),
            }),
          },
          authMiddleware,
          dbMiddleware,
        ),
      );

      const res = await handler(new Request('http://localhost/data'), { API_KEY: 'secret-key' });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {
        apiKey: 'secret-key',
        userId: 'user-123',
        userRole: 'admin',
        dbStatus: 'connected',
      });
    });
  });
});

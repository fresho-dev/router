import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './index.js';
import { createHandler } from './handler.js';
import type { MiddlewareContext, MiddlewareNext } from './middleware.js';

describe('standalone router', () => {
  describe('createHandler()', () => {
    it('returns 404 for unmatched routes', async () => {
      const handler = createHandler(router('', {}));
      const res = await handler(new Request('http://localhost/unknown'));
      assert.strictEqual(res.status, 404);
    });

    it('matches GET routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { ok: true });
    });

    it('matches POST routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            handler: async () => Response.json({ method: 'post' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test', { method: 'POST' }));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { method: 'post' });
    });

    it('matches PUT routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'put',
            path: '/test',
            handler: async () => Response.json({ method: 'put' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test', { method: 'PUT' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches PATCH routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'patch',
            path: '/test',
            handler: async () => Response.json({ method: 'patch' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test', { method: 'PATCH' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches DELETE routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'delete',
            path: '/test',
            handler: async () => Response.json({ method: 'delete' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test', { method: 'DELETE' }));
      assert.strictEqual(res.status, 200);
    });

    it('matches OPTIONS routes', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'options',
            path: '/test',
            handler: async () => Response.json({ method: 'options' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test', { method: 'OPTIONS' }));
      assert.strictEqual(res.status, 200);
    });

    it('uses router base path', async () => {
      const handler = createHandler(
        router('/api', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const matched = await handler(new Request('http://localhost/api/test'));
      assert.strictEqual(matched.status, 200);

      const notMatched = await handler(new Request('http://localhost/test'));
      assert.strictEqual(notMatched.status, 404);
    });

    it('combines nested router paths', async () => {
      const inner = router('/inner', {
        test: route({
          method: 'get',
          path: '/test',
          handler: async () => Response.json({ nested: true }),
        }),
      });

      const handler = createHandler(router('/outer', { inner }));

      const res = await handler(new Request('http://localhost/outer/inner/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { nested: true });
    });

    it('handles deeply nested routers (3+ levels)', async () => {
      const l3 = router('/l3', {
        r: route({ method: 'get', path: '/r', handler: async () => Response.json({ level: 3 }) }),
      });
      const l2 = router('/l2', { l3 });
      const l1 = router('/l1', { l2 });

      const handler = createHandler(l1);

      const res = await handler(new Request('http://localhost/l1/l2/l3/r'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { level: 3 });
    });

    it('multiple routes on same path with different methods', async () => {
      const handler = createHandler(
        router('', {
          getUsers: route({ method: 'get', path: '/users', handler: async () => Response.json({ action: 'list' }) }),
          createUser: route({
            method: 'post',
            path: '/users',
            handler: async () => Response.json({ action: 'create' }),
          }),
        })
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
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async (c) => Response.json({ name: c.params.query.name }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?name=alice'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid required number (coerces from string)', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { count: 'number' },
            handler: async (c) => Response.json({ count: c.params.query.count }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?count=42'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { count: 42 });
    });

    it('passes valid required boolean (coerces from string)', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { active: 'boolean' },
            handler: async (c) => Response.json({ active: c.params.query.active }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?active=true'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { active: true });
    });

    it('passes optional params when present', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string?' },
            handler: async (c) => Response.json({ name: c.params.query.name }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?name=bob'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'bob' });
    });

    it('passes when optional params are missing', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string?' },
            handler: async (c) => Response.json({ query: c.params.query }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('fails when required param is missing', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.ok(body.error.includes('Invalid'));
    });

    it('fails when number param is not numeric', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { count: 'number' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?count=notanumber'));
      assert.strictEqual(res.status, 400);
    });
  });

  describe('body validation', () => {
    it('passes valid body for POST', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { name: 'string' },
            handler: async (c) => Response.json({ name: c.params.body.name }),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'alice' }),
        })
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid body for PUT', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'put',
            path: '/test',
            body: { name: 'string' },
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'bob' }),
        })
      );
      assert.strictEqual(res.status, 200);
    });

    it('passes valid body for PATCH', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'patch',
            path: '/test',
            body: { name: 'string?' },
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      );
      assert.strictEqual(res.status, 200);
    });

    it('fails when required body field is missing', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { name: 'string', email: 'string' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'alice' }), // missing email
        })
      );
      assert.strictEqual(res.status, 400);
    });

    it('returns error with details', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { count: 'number' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 'not a number' }),
        })
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
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
    });

    it('route with empty query schema', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: {},
            handler: async (c) => Response.json({ query: c.params.query }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test?ignored=param'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('special characters in query values', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { q: 'string' },
            handler: async (c) => Response.json({ q: c.params.query.q }),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test?q=' + encodeURIComponent('hello world & more'))
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { q: 'hello world & more' });
    });

    it('unicode in query params', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async (c) => Response.json({ name: c.params.query.name }),
          }),
        })
      );

      const res = await handler(
        new Request('http://localhost/test?name=' + encodeURIComponent('日本語'))
      );
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: '日本語' });
    });

    it('route without handler still validates', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { required: 'string' },
            // no handler
          }),
        })
      );

      // Missing required param should still fail validation.
      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 400);
    });

    it('route without handler returns empty JSON on success', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            // no handler
          }),
        })
      );

      const res = await handler(new Request('http://localhost/test'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {});
    });

    it('does not call handler when validation fails', async () => {
      let handlerCalled = false;
      const handler = createHandler(
        router('', {
          r: route({
            method: 'get',
            path: '/r',
            query: { required: 'string' },
            handler: async () => {
              handlerCalled = true;
              return Response.json({});
            },
          }),
        })
      );

      await handler(new Request('http://localhost/r')); // missing required param
      assert.strictEqual(handlerCalled, false);
    });

    it('passes env and ctx to handler via context', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async (c) =>
              Response.json({
                hasEnv: c.env !== undefined,
                hasCtx: c.executionCtx !== undefined,
              }),
          }),
        })
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
        router('', {
          getBook: route({
            method: 'get',
            path: '/books/:id',
            handler: async (c) => Response.json({ bookId: c.params.path.id }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/books/123'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: '123' });
    });

    it('extracts multiple path parameters', async () => {
      const handler = createHandler(
        router('', {
          getChapter: route({
            method: 'get',
            path: '/books/:bookId/chapters/:chapterId',
            handler: async (c) =>
              Response.json({ bookId: c.params.path.bookId, chapterId: c.params.path.chapterId }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/books/abc/chapters/42'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: 'abc', chapterId: '42' });
    });

    it('path params work alongside query params', async () => {
      const handler = createHandler(
        router('', {
          getBook: route({
            method: 'get',
            path: '/books/:id',
            query: { format: 'string?' },
            handler: async (c) =>
              Response.json({ bookId: c.params.path.id, format: c.params.query.format ?? 'json' }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/books/123?format=xml'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { bookId: '123', format: 'xml' });
    });

    it('extracts path param with file extension suffix', async () => {
      const handler = createHandler(
        router('', {
          getFile: route({
            method: 'get',
            path: '/files/:name.pdf',
            handler: async (c) => Response.json({ name: c.params.path.name }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/files/document.pdf'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'document' });
    });

    it('does not match wrong extension', async () => {
      const handler = createHandler(
        router('', {
          getFile: route({
            method: 'get',
            path: '/files/:name.pdf',
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/files/document.txt'));
      assert.strictEqual(res.status, 404);
    });

    it('handles multiple params with extensions', async () => {
      const handler = createHandler(
        router('', {
          getAudio: route({
            method: 'get',
            path: '/audio/:artist-:track.mp3',
            handler: async (c) =>
              Response.json({ artist: c.params.path.artist, track: c.params.path.track }),
          }),
        })
      );

      const res = await handler(new Request('http://localhost/audio/beatles-yesterday.mp3'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { artist: 'beatles', track: 'yesterday' });
    });

    it('escapes special regex characters in path literals', async () => {
      const handler = createHandler(
        router('', {
          getFile: route({
            method: 'get',
            path: '/files/:name.tar.gz',
            handler: async (c) => Response.json({ name: c.params.path.name }),
          }),
        })
      );

      // Should match literal .tar.gz
      const res = await handler(new Request('http://localhost/files/archive.tar.gz'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'archive' });

      // Should NOT match .tarXgz (unescaped . would match any char)
      const res2 = await handler(new Request('http://localhost/files/archiveXtarXgz'));
      assert.strictEqual(res2.status, 404);
    });
  });


  describe('middleware to handler context passing', () => {
    // Define context types for type-safe middleware-to-handler communication.
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
          '',
          {
            // Use route.ctx<T>() for clean context typing.
            profile: route.ctx<UserContext>()({
              method: 'get',
              path: '/profile',
              handler: async (c) => {
                // c.user is fully typed - no casting needed.
                return Response.json({ userId: c.user.id, userName: c.user.name });
              },
            }),
          },
          [authMiddleware]
        )
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
          '',
          {
            data: route.ctx<PermissionsContext>()({
              method: 'get',
              path: '/data',
              handler: async (c) => {
                // Both user and permissions are typed.
                return Response.json({
                  userId: c.user.id,
                  canRead: c.permissions.includes('read'),
                  canWrite: c.permissions.includes('write'),
                });
              },
            }),
          },
          [authMiddleware, permissionsMiddleware]
        )
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
          '',
          {
            status: route.ctx<DbContext>()({
              method: 'get',
              path: '/status',
              handler: async (c) => {
                // dbConnection is typed, env still needs casting (it's always unknown).
                const env = c.env as { API_KEY: string };
                return Response.json({
                  apiKey: env.API_KEY,
                  dbStatus: c.dbConnection,
                });
              },
            }),
          },
          [dbMiddleware]
        )
      );

      const res = await handler(new Request('http://localhost/status'), { API_KEY: 'secret123' });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {
        apiKey: 'secret123',
        dbStatus: 'connected',
      });
    });
  });
});

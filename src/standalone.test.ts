import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './index.js';
import { createHandler } from './standalone.js';

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
            handler: async (request, { query }) => Response.json({ name: query.name }),
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
            handler: async (request, { query }) => Response.json({ count: query.count }),
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
            handler: async (request, { query }) => Response.json({ active: query.active }),
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
            handler: async (request, { query }) => Response.json({ name: query.name }),
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
            handler: async (request, { query }) => Response.json({ query }),
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
            handler: async (request, { body }) => Response.json({ name: body.name }),
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
            handler: async (request, { query }) => Response.json({ query }),
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
            handler: async (request, { query }) => Response.json({ q: query.q }),
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
            handler: async (request, { query }) => Response.json({ name: query.name }),
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

    it('passes env and ctx to handler', async () => {
      const handler = createHandler(
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async (request, params, env, ctx) =>
              Response.json({
                hasEnv: env !== undefined,
                hasCtx: ctx !== undefined,
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
});

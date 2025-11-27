import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Hono } from 'hono';
import { route, router } from './index.js';
import { mount } from './hono.js';

describe('hono adapter', () => {
  describe('mount()', () => {
    it('registers GET routes', async () => {
      const app = new Hono();
      mount(app, router('', { r: route({ method: 'get', path: '/r', handler: async () => Response.json({ m: 'get' }) }) }));
      const res = await app.request('/r');
      assert.strictEqual(res.status, 200);
    });

    it('registers POST routes', async () => {
      const app = new Hono();
      mount(
        app,
        router('', { r: route({ method: 'post', path: '/r', handler: async () => Response.json({ m: 'post' }) }) })
      );
      const res = await app.request('/r', { method: 'POST' });
      assert.strictEqual(res.status, 200);
    });

    it('registers PUT routes', async () => {
      const app = new Hono();
      mount(app, router('', { r: route({ method: 'put', path: '/r', handler: async () => Response.json({ m: 'put' }) }) }));
      const res = await app.request('/r', { method: 'PUT' });
      assert.strictEqual(res.status, 200);
    });

    it('registers PATCH routes', async () => {
      const app = new Hono();
      mount(
        app,
        router('', { r: route({ method: 'patch', path: '/r', handler: async () => Response.json({ m: 'patch' }) }) })
      );
      const res = await app.request('/r', { method: 'PATCH' });
      assert.strictEqual(res.status, 200);
    });

    it('registers DELETE routes', async () => {
      const app = new Hono();
      mount(
        app,
        router('', { r: route({ method: 'delete', path: '/r', handler: async () => Response.json({ m: 'delete' }) }) })
      );
      const res = await app.request('/r', { method: 'DELETE' });
      assert.strictEqual(res.status, 200);
    });

    it('registers OPTIONS routes', async () => {
      const app = new Hono();
      mount(
        app,
        router('', { r: route({ method: 'options', path: '/r', handler: async () => Response.json({ m: 'options' }) }) })
      );
      const res = await app.request('/r', { method: 'OPTIONS' });
      assert.strictEqual(res.status, 200);
    });

    it('uses router base path', async () => {
      const app = new Hono();
      mount(app, router('/api', { r: route({ method: 'get', path: '/users', handler: async () => Response.json({}) }) }));

      const res = await app.request('/api/users');
      assert.strictEqual(res.status, 200);

      const notFound = await app.request('/users');
      assert.strictEqual(notFound.status, 404);
    });

    it('combines nested router paths correctly', async () => {
      const app = new Hono();
      const inner = router('/inner', {
        test: route({ method: 'get', path: '/test', handler: async () => Response.json({ found: true }) }),
      });
      mount(app, router('/outer', { inner }));

      const res = await app.request('/outer/inner/test');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { found: true });
    });

    it('handles deeply nested routers (3+ levels)', async () => {
      const app = new Hono();
      const l3 = router('/l3', { r: route({ method: 'get', path: '/r', handler: async () => Response.json({ level: 3 }) }) });
      const l2 = router('/l2', { l3 });
      const l1 = router('/l1', { l2 });
      mount(app, l1);

      const res = await app.request('/l1/l2/l3/r');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { level: 3 });
    });

    it('does not call handler when validation fails', async () => {
      let handlerCalled = false;
      const app = new Hono();
      mount(
        app,
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

      await app.request('/r'); // missing required param
      assert.strictEqual(handlerCalled, false);
    });

    it('multiple routes on same path with different methods', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          getUsers: route({ method: 'get', path: '/users', handler: async () => Response.json({ action: 'list' }) }),
          createUser: route({ method: 'post', path: '/users', handler: async () => Response.json({ action: 'create' }) }),
        })
      );

      const getRes = await app.request('/users');
      assert.deepStrictEqual(await getRes.json(), { action: 'list' });

      const postRes = await app.request('/users', { method: 'POST' });
      assert.deepStrictEqual(await postRes.json(), { action: 'create' });
    });
  });

  describe('query validation', () => {
    it('passes valid required string', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async (request, { query }) => Response.json({ name: query.name }),
          }),
        })
      );

      const res = await app.request('/test?name=alice');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid required number (coerces from string)', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { count: 'number' },
            handler: async (request, { query }) => Response.json({ count: query.count }),
          }),
        })
      );

      const res = await app.request('/test?count=42');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { count: 42 });
    });

    it('passes valid required boolean (coerces from string)', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { active: 'boolean' },
            handler: async (request, { query }) => Response.json({ active: query.active }),
          }),
        })
      );

      const res = await app.request('/test?active=true');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { active: true });
    });

    it('passes optional params when present', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string?' },
            handler: async (request, { query }) => Response.json({ name: query.name }),
          }),
        })
      );

      const res = await app.request('/test?name=bob');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'bob' });
    });

    it('passes when optional params are missing', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string?' },
            handler: async (request, { query }) => Response.json({ query }),
          }),
        })
      );

      const res = await app.request('/test');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('fails when required param is missing', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await app.request('/test');
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.ok(body.error.includes('Invalid'));
    });

    it('fails when number param is not numeric', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { count: 'number' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await app.request('/test?count=notanumber');
      assert.strictEqual(res.status, 400);
    });
  });

  describe('body validation', () => {
    it('passes valid body for POST', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { name: 'string' },
            handler: async (request, { body }) => Response.json({ name: body.name }),
          }),
        })
      );

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'alice' }),
      });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: 'alice' });
    });

    it('passes valid body for PUT', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'put',
            path: '/test',
            body: { name: 'string' },
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await app.request('/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bob' }),
      });
      assert.strictEqual(res.status, 200);
    });

    it('passes valid body for PATCH', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'patch',
            path: '/test',
            body: { name: 'string?' },
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await app.request('/test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 200);
    });

    it('fails when required body field is missing', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { name: 'string', email: 'string' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'alice' }), // missing email
      });
      assert.strictEqual(res.status, 400);
    });

    it('returns error with details', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'post',
            path: '/test',
            body: { count: 'number' },
            handler: async () => Response.json({}),
          }),
        })
      );

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 'not a number' }),
      });
      assert.strictEqual(res.status, 400);
      const body = (await res.json()) as { error: string; details: object };
      assert.ok(body.error);
      assert.ok(body.details);
    });
  });

  describe('edge cases', () => {
    it('empty router (no routes)', async () => {
      const app = new Hono();
      mount(app, router('/api', {}));

      const res = await app.request('/api/anything');
      assert.strictEqual(res.status, 404);
    });

    it('route with no query or body schema', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            handler: async () => Response.json({ ok: true }),
          }),
        })
      );

      const res = await app.request('/test');
      assert.strictEqual(res.status, 200);
    });

    it('route with empty query schema', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: {},
            handler: async (request, { query }) => Response.json({ query }),
          }),
        })
      );

      const res = await app.request('/test?ignored=param');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { query: {} });
    });

    it('special characters in query values', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { q: 'string' },
            handler: async (request, { query }) => Response.json({ q: query.q }),
          }),
        })
      );

      const res = await app.request('/test?q=' + encodeURIComponent('hello world & more'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { q: 'hello world & more' });
    });

    it('unicode in query params', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { name: 'string' },
            handler: async (request, { query }) => Response.json({ name: query.name }),
          }),
        })
      );

      const res = await app.request('/test?name=' + encodeURIComponent('日本語'));
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { name: '日本語' });
    });

    it('route without handler still validates', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            query: { required: 'string' },
            // no handler
          }),
        })
      );

      // Missing required param should still fail validation
      const res = await app.request('/test');
      assert.strictEqual(res.status, 400);
    });

    it('route without handler returns empty JSON on success', async () => {
      const app = new Hono();
      mount(
        app,
        router('', {
          test: route({
            method: 'get',
            path: '/test',
            // no handler
          }),
        })
      );

      const res = await app.request('/test');
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), {});
    });
  });
});

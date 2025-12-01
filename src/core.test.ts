import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './core.js';

describe('core', () => {
  describe('route()', () => {
    it('creates a route definition with all properties', () => {
      const handler = async () => ({ data: [] });
      const r = route({
        query: { limit: 'number?', offset: 'number?' },
        body: { name: 'string' },
        description: 'List users',
        handler,
      });

      assert.deepStrictEqual(r.query, { limit: 'number?', offset: 'number?' });
      assert.deepStrictEqual(r.body, { name: 'string' });
      assert.strictEqual(r.description, 'List users');
      assert.strictEqual(r.handler, handler);
    });

    it('works with minimal properties', () => {
      const handler = async () => ({ status: 'ok' });
      const r = route({ handler });
      assert.strictEqual(r.handler, handler);
      assert.strictEqual(r.query, undefined);
      assert.strictEqual(r.body, undefined);
    });

    it('supports all HTTP methods', () => {
      // Methods are now determined by where route is placed in router,
      // not a property of the route itself.
      const handler = async () => ({});
      const r = router({
        get: route({ handler }),
        post: route({ handler }),
        put: route({ handler }),
        patch: route({ handler }),
        delete: route({ handler }),
      });
      assert.ok(r.routes.get);
      assert.ok(r.routes.post);
      assert.ok(r.routes.put);
      assert.ok(r.routes.patch);
      assert.ok(r.routes.delete);
    });
  });

  describe('router()', () => {
    it('creates a router with routes', () => {
      const r = router({
        users: router({
          get: async () => [],
        }),
      });

      assert.ok(r.routes.users);
    });

    it('supports nested routers', () => {
      const inner = router({
        get: async () => ({ test: true }),
      });
      const outer = router({ inner });

      assert.ok(outer.routes.inner);
      assert.ok(outer.routes.inner.routes.get);
    });

    it('supports deeply nested routers (3+ levels)', () => {
      const level3 = router({ get: async () => ({ level: 3 }) });
      const level2 = router({ level3 });
      const level1 = router({ level2 });

      assert.ok(level1.routes.level2.routes.level3.routes.get);
    });

    it('provides handler() method', () => {
      const r = router({});
      assert.strictEqual(typeof r.handler, 'function');
    });

    it('handles empty routes object', () => {
      const r = router({});
      assert.deepStrictEqual(r.routes, {});
    });

    it('preserves route properties in routes object', () => {
      const handler = async () => ({ created: true });
      const r = router({
        users: router({
          post: route({
            query: { limit: 'number' },
            body: { name: 'string' },
            description: 'Create user',
            handler,
          }),
        }),
      });

      const usersRoute = r.routes.users.routes.post as { query?: unknown; body?: unknown; description?: string };
      assert.deepStrictEqual(usersRoute.query, { limit: 'number' });
      assert.deepStrictEqual(usersRoute.body, { name: 'string' });
      assert.strictEqual(usersRoute.description, 'Create user');
    });
  });
});

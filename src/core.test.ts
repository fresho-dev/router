import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router } from './core.js';

describe('core', () => {
  describe('route()', () => {
    it('creates a route definition with all properties', () => {
      const handler = async () => Response.json({});
      const r = route({
        method: 'get',
        path: '/users',
        query: { limit: 'number?', offset: 'number?' },
        body: { name: 'string' },
        description: 'List users',
        handler,
      });

      assert.strictEqual(r.method, 'get');
      assert.strictEqual(r.path, '/users');
      assert.deepStrictEqual(r.query, { limit: 'number?', offset: 'number?' });
      assert.deepStrictEqual(r.body, { name: 'string' });
      assert.strictEqual(r.description, 'List users');
      assert.strictEqual(r.handler, handler);
    });

    it('works with minimal properties', () => {
      const r = route({ method: 'get', path: '/health' });
      assert.strictEqual(r.method, 'get');
      assert.strictEqual(r.path, '/health');
      assert.strictEqual(r.query, undefined);
      assert.strictEqual(r.body, undefined);
    });

    it('supports all HTTP methods', () => {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'options'] as const;
      for (const method of methods) {
        const r = route({ method, path: '/test' });
        assert.strictEqual(r.method, method);
      }
    });
  });

  describe('router()', () => {
    it('creates a router with base path and routes', () => {
      const r = router('/api', {
        users: route({ method: 'get', path: '/users' }),
      });

      assert.strictEqual(r.basePath, '/api');
      assert.ok(r.routes.users);
    });

    it('supports nested routers', () => {
      const inner = router('/inner', {
        test: route({ method: 'get', path: '/test' }),
      });
      const outer = router('/outer', { inner });

      assert.strictEqual(outer.routes.inner.basePath, '/inner');
      assert.strictEqual(outer.routes.inner.routes.test.path, '/test');
    });

    it('supports deeply nested routers (3+ levels)', () => {
      const level3 = router('/l3', { r: route({ method: 'get', path: '/r' }) });
      const level2 = router('/l2', { level3 });
      const level1 = router('/l1', { level2 });

      assert.strictEqual(level1.routes.level2.routes.level3.routes.r.path, '/r');
    });

    it('provides httpClient() and localClient() methods', () => {
      const r = router('/api', {});
      assert.strictEqual(typeof r.httpClient, 'function');
      assert.strictEqual(typeof r.localClient, 'function');
    });

    it('handles empty base path', () => {
      const r = router('', { test: route({ method: 'get', path: '/test' }) });
      assert.strictEqual(r.basePath, '');
    });

    it('handles empty routes object', () => {
      const r = router('/api', {});
      assert.strictEqual(r.basePath, '/api');
      assert.deepStrictEqual(r.routes, {});
    });

    it('preserves route properties in routes object', () => {
      const handler = async () => Response.json({});
      const r = router('/api', {
        users: route({
          method: 'post',
          path: '/users',
          query: { limit: 'number' },
          body: { name: 'string' },
          description: 'Create user',
          handler,
        }),
      });

      const usersRoute = r.routes.users;
      assert.strictEqual(usersRoute.method, 'post');
      assert.strictEqual(usersRoute.path, '/users');
      assert.deepStrictEqual(usersRoute.query, { limit: 'number' });
      assert.deepStrictEqual(usersRoute.body, { name: 'string' });
      assert.strictEqual(usersRoute.description, 'Create user');
    });
  });
});

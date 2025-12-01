import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isRouter, isRoute, type CollectPathParams } from './types.js';
import { route, router } from './core.js';

describe('types', () => {
  describe('isRouter()', () => {
    it('returns true for router objects', () => {
      const r = router({});
      assert.strictEqual(isRouter(r), true);
    });

    it('returns false for route objects', () => {
      const r = route({ handler: async () => ({}) });
      assert.strictEqual(isRouter(r), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isRouter(null), false);
    });

    it('returns false for undefined', () => {
      assert.strictEqual(isRouter(undefined), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isRouter('string'), false);
      assert.strictEqual(isRouter(123), false);
      assert.strictEqual(isRouter(true), false);
    });

    it('returns false for plain objects without ROUTER_MARKER', () => {
      assert.strictEqual(isRouter({ routes: {} }), false);
    });

    it('returns true for router objects with routes', () => {
      const r = router({ test: router({ get: async () => ({}) }) });
      assert.strictEqual(isRouter(r), true);
    });
  });

  describe('isRoute()', () => {
    it('returns true for route objects', () => {
      const r = route({ handler: async () => ({}) });
      assert.strictEqual(isRoute(r), true);
    });

    it('returns false for router objects', () => {
      const r = router({});
      assert.strictEqual(isRoute(r), false);
    });

    it('returns false for null', () => {
      assert.strictEqual(isRoute(null), false);
    });

    it('returns false for undefined', () => {
      assert.strictEqual(isRoute(undefined), false);
    });

    it('returns false for primitives', () => {
      assert.strictEqual(isRoute('string'), false);
      assert.strictEqual(isRoute(123), false);
      assert.strictEqual(isRoute(true), false);
    });

    it('returns false for plain objects without ROUTE_MARKER', () => {
      assert.strictEqual(isRoute({ handler: () => ({}) }), false);
    });

    it('returns true for route objects with schemas', () => {
      const r = route({ query: { name: 'string' }, handler: async () => ({}) });
      assert.strictEqual(isRoute(r), true);
    });
  });

  describe('CollectPathParams', () => {
    it('extracts single path parameter type', () => {
      // With the new API, path params come from $param property names.
      const api = router({
        users: router({
          $id: router({
            get: async (c) => {
              const id: string = c.path.id;
              return Response.json({ id });
            },
          }),
        }),
      });

      // Runtime check that router was created.
      assert.ok(api.routes.users);
    });

    it('extracts multiple path parameters type', () => {
      // With nested $param routers.
      const api = router({
        users: router({
          $userId: router({
            posts: router({
              $postId: router({
                get: async (c) => {
                  const userId: string = c.path.userId;
                  const postId: string = c.path.postId;
                  return Response.json({ userId, postId });
                },
              }),
            }),
          }),
        }),
      });

      assert.ok(api.routes.users);
    });

    it('handles routes without path parameters', () => {
      const api = router({
        users: router({
          get: async (c) => {
            return Response.json({ path: c.path });
          },
        }),
      });

      assert.ok(api.routes.users);
    });

    it('verifies type inference at compile time', () => {
      // With the new design, path params are collected from $param property names.
      type SingleParam = CollectPathParams<['$id']>;
      type MultiParam = CollectPathParams<['$userId', 'posts', '$postId']>;
      type NoParams = CollectPathParams<['users']>;

      // These type assertions will fail to compile if types are wrong.
      const _single: SingleParam = { id: 'test' };
      const _multi: MultiParam = { userId: 'u1', postId: 'p1' };
      const _none: NoParams = {};

      // Runtime assertion to satisfy test runner.
      assert.ok(true);
    });
  });
});

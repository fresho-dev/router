import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isRouter, isRoute, type ExtractPathParams } from './types.js';
import { route, router } from './core.js';

describe('types', () => {
  describe('isRouter()', () => {
    it('returns true for router objects', () => {
      const r = router('/api', {});
      assert.strictEqual(isRouter(r), true);
    });

    it('returns false for route objects', () => {
      const r = route({ method: 'get', path: '/test' });
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

    it('returns false for plain objects without basePath', () => {
      assert.strictEqual(isRouter({ method: 'get' }), false);
    });

    it('returns true for objects with basePath property', () => {
      assert.strictEqual(isRouter({ basePath: '/api', routes: {} }), true);
    });
  });

  describe('isRoute()', () => {
    it('returns true for route objects', () => {
      const r = route({ method: 'get', path: '/test' });
      assert.strictEqual(isRoute(r), true);
    });

    it('returns false for router objects', () => {
      const r = router('/api', {});
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

    it('returns false for plain objects without method', () => {
      assert.strictEqual(isRoute({ path: '/test' }), false);
    });

    it('returns true for objects with method property', () => {
      assert.strictEqual(isRoute({ method: 'get' }), true);
    });
  });

  describe('ExtractPathParams', () => {
    it('extracts single path parameter type', () => {
      // Compile-time test: create a route with path param and verify type
      const getUser = route({
        method: 'get',
        path: '/users/:id',
        handler: (c) => {
          // TypeScript should know c.params.path.id is string
          const id: string = c.params.path.id;
          return Response.json({ id });
        },
      });

      // Runtime check that route was created
      assert.strictEqual(getUser.path, '/users/:id');
    });

    it('extracts multiple path parameters type', () => {
      // Compile-time test: create a route with multiple path params
      const getPost = route({
        method: 'get',
        path: '/users/:userId/posts/:postId',
        handler: (c) => {
          // TypeScript should know both params exist
          const userId: string = c.params.path.userId;
          const postId: string = c.params.path.postId;
          return Response.json({ userId, postId });
        },
      });

      assert.strictEqual(getPost.path, '/users/:userId/posts/:postId');
    });

    it('handles routes without path parameters', () => {
      const listUsers = route({
        method: 'get',
        path: '/users',
        handler: (c) => {
          // c.params.path should be Record<string, never> (empty)
          // This is a compile-time check - at runtime we just verify the route
          return Response.json({ path: c.params.path });
        },
      });

      assert.strictEqual(listUsers.path, '/users');
    });

    it('verifies type inference at compile time', () => {
      // This is primarily a compile-time test that verifies ExtractPathParams works
      type SingleParam = ExtractPathParams<'/users/:id'>;
      type MultiParam = ExtractPathParams<'/users/:userId/posts/:postId'>;
      type NoParams = ExtractPathParams<'/users'>;

      // These type assertions will fail to compile if types are wrong
      const _single: SingleParam = { id: 'test' };
      const _multi: MultiParam = { userId: 'u1', postId: 'p1' };
      const _none: NoParams = {};

      // Runtime assertion to satisfy test runner
      assert.ok(true);
    });
  });
});

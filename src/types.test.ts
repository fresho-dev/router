import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isRouter, isRoute } from './types.js';
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
});

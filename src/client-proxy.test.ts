import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createRecursiveProxy, type RecursiveProxyOptions } from './client-proxy.js';
import type { Method } from './types.js';

describe('client-proxy', () => {
  describe('createRecursiveProxy', () => {
    it('accumulates path segments', async () => {
      let lastSegments: string[] = [];

      const proxy = createRecursiveProxy({
        onRequest: async (segments, method, options) => {
          lastSegments = segments;
        },
      } as RecursiveProxyOptions) as any;

      await proxy.foo.bar.baz.$get();
      assert.deepStrictEqual(lastSegments, ['foo', 'bar', 'baz']);
    });

    it('traps HTTP methods', async () => {
      let lastMethod: Method | undefined;

      const proxy = createRecursiveProxy({
        onRequest: async (segments, method, options) => {
          lastMethod = method;
        },
      } as RecursiveProxyOptions) as any;

      await proxy.$get();
      assert.strictEqual(lastMethod, 'get');

      await proxy.$post();
      assert.strictEqual(lastMethod, 'post');

      await proxy.$put();
      assert.strictEqual(lastMethod, 'put');

      await proxy.$patch();
      assert.strictEqual(lastMethod, 'patch');

      await proxy.$delete();
      assert.strictEqual(lastMethod, 'delete');
    });

    it('supports implicit GET via direct call', async () => {
      let lastMethod: Method | undefined;
      let lastSegments: string[] = [];

      const proxy = createRecursiveProxy({
        onRequest: async (segments, method, options) => {
          lastMethod = method;
          lastSegments = segments;
        },
      } as RecursiveProxyOptions) as any;

      await proxy.users();
      assert.strictEqual(lastMethod, 'get');
      assert.deepStrictEqual(lastSegments, ['users']);

      // Nested
      await proxy.users.profile();
      assert.strictEqual(lastMethod, 'get');
      assert.deepStrictEqual(lastSegments, ['users', 'profile']);
    });

    it('passes options correctly', async () => {
      let lastOptions: any;

      const proxy = createRecursiveProxy({
        onRequest: async (segments, method, options) => {
          lastOptions = options;
        },
      } as RecursiveProxyOptions) as any;

      const query = { q: 'search' };
      await proxy.search.$get({ query });
      assert.deepStrictEqual(lastOptions, { query });
    });

    it('does not treat apply/call/bind/toString/toJSON as path segments', () => {
      const proxy = createRecursiveProxy({
        onRequest: async () => {},
      } as RecursiveProxyOptions) as any;

      // Should return function methods, not a new proxy for a path segment
      assert.strictEqual(typeof proxy.apply, 'function');
      assert.strictEqual(typeof proxy.call, 'function');
      assert.strictEqual(typeof proxy.bind, 'function');
      assert.strictEqual(typeof proxy.toString, 'function');

      // We can check identity if possible, but basic type check + behavior is good enough.
      // Function.prototype.apply is generic, so proxy.apply should equal Function.prototype.apply
      // IF the proxy target is a function (which it is).
      assert.strictEqual(proxy.apply, Function.prototype.apply);
      assert.strictEqual(proxy.call, Function.prototype.call);
      assert.strictEqual(proxy.bind, Function.prototype.bind);
      assert.strictEqual(proxy.toString, Function.prototype.toString);
    });

    it('allows using apply() to invoke the proxy function (implicit GET)', async () => {
      let triggered = false;
      let lastSegments: string[] = [];

      const proxy = createRecursiveProxy({
        onRequest: async (segments) => {
          triggered = true;
          lastSegments = segments;
        },
      } as RecursiveProxyOptions) as any;

      // proxy.apply(null, []) should call the underlying function, which triggers implicit GET
      await proxy.foo.apply(null, []);

      assert.strictEqual(triggered, true);
      assert.deepStrictEqual(lastSegments, ['foo']);
    });
  });
});

/**
 * @fileoverview Tests for core middleware functionality.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  type Middleware,
  type MiddlewareContext,
  runMiddleware,
  compose,
  forMethods,
  forPaths,
  skipPaths,
} from './middleware.js';

describe('Middleware', () => {
  let context: MiddlewareContext;

  beforeEach(() => {
    context = {
      request: new Request('http://example.com/test'),
      params: { path: {}, query: {}, body: {} },
      env: {},
    };
  });

  describe('runMiddleware', () => {
    it('should run middleware in order', async () => {
      const order: number[] = [];

      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        const response = await next();
        order.push(4);
        return response;
      };

      const middleware2: Middleware = async (ctx, next) => {
        order.push(2);
        const response = await next();
        order.push(3);
        return response;
      };

      const finalHandler = async () => {
        order.push(0);
        return new Response('final');
      };

      const response = await runMiddleware([middleware1, middleware2], context, finalHandler);

      assert.strictEqual(await response.text(), 'final');
      assert.deepStrictEqual(order, [1, 2, 0, 3, 4]);
    });

    it('should allow middleware to short-circuit', async () => {
      const order: number[] = [];

      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        return new Response('short-circuit');
      };

      const middleware2: Middleware = async (ctx, next) => {
        order.push(2);
        return next();
      };

      const finalHandler = async () => {
        order.push(0);
        return new Response('final');
      };

      const response = await runMiddleware([middleware1, middleware2], context, finalHandler);

      assert.strictEqual(await response.text(), 'short-circuit');
      assert.deepStrictEqual(order, [1]);
    });

    it('should pass context through middleware', async () => {
      const middleware1: Middleware = async (ctx, next) => {
        ctx.value1 = 'test1';
        return next();
      };

      const middleware2: Middleware = async (ctx, next) => {
        ctx.value2 = 'test2';
        assert.strictEqual(ctx.value1, 'test1');
        return next();
      };

      const finalHandler = async () => {
        assert.strictEqual(context.value1, 'test1');
        assert.strictEqual(context.value2, 'test2');
        return new Response('ok');
      };

      await runMiddleware([middleware1, middleware2], context, finalHandler);
    });

    it('should handle errors in middleware', async () => {
      const middleware: Middleware = async (ctx, next) => {
        throw new Error('middleware error');
      };

      const finalHandler = async () => new Response('ok');

      await assert.rejects(
        runMiddleware([middleware], context, finalHandler),
        /middleware error/
      );
    });

    it('should handle empty middleware array', async () => {
      const finalHandler = async () => new Response('final');
      const response = await runMiddleware([], context, finalHandler);
      assert.strictEqual(await response.text(), 'final');
    });
  });

  describe('compose', () => {
    it('should compose multiple middleware into one', async () => {
      const order: number[] = [];

      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        const response = await next();
        order.push(4);
        return response;
      };

      const middleware2: Middleware = async (ctx, next) => {
        order.push(2);
        const response = await next();
        order.push(3);
        return response;
      };

      const composed = compose(middleware1, middleware2);

      const response = await composed(context, async () => {
        order.push(0);
        return new Response('final');
      });

      assert.strictEqual(await response.text(), 'final');
      assert.deepStrictEqual(order, [1, 2, 0, 3, 4]);
    });

    it('should handle empty composition', async () => {
      const composed = compose();
      const response = await composed(context, async () => new Response('final'));
      assert.strictEqual(await response.text(), 'final');
    });
  });

  describe('forMethods', () => {
    it('should only run middleware for specified methods', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = forMethods(['POST', 'PUT'], middleware);

      // Test GET (should not execute)
      context.request = new Request('http://example.com/test', { method: 'GET' });
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);

      // Test POST (should execute)
      context.request = new Request('http://example.com/test', { method: 'POST' });
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test PUT (should execute)
      executed = false;
      context.request = new Request('http://example.com/test', { method: 'PUT' });
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);
    });

    it('should handle case-insensitive methods', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = forMethods(['post'], middleware);

      context.request = new Request('http://example.com/test', { method: 'POST' });
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);
    });
  });

  describe('forPaths', () => {
    it('should only run middleware for matching string paths', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = forPaths(['/api/', '/admin/'], middleware);

      // Test /api/users (should execute)
      context.request = new Request('http://example.com/api/users');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /admin/settings (should execute)
      executed = false;
      context.request = new Request('http://example.com/admin/settings');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /public/assets (should not execute)
      executed = false;
      context.request = new Request('http://example.com/public/assets');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);
    });

    it('should support regex paths', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = forPaths([/^\/api\/v\d+\//], middleware);

      // Test /api/v1/users (should execute)
      context.request = new Request('http://example.com/api/v1/users');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /api/v2/posts (should execute)
      executed = false;
      context.request = new Request('http://example.com/api/v2/posts');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /api/users (should not execute)
      executed = false;
      context.request = new Request('http://example.com/api/users');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);
    });
  });

  describe('skipPaths', () => {
    it('should skip middleware for matching string paths', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = skipPaths(['/public/', '/health'], middleware);

      // Test /api/users (should execute)
      context.request = new Request('http://example.com/api/users');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /public/assets (should not execute)
      executed = false;
      context.request = new Request('http://example.com/public/assets');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);

      // Test /health (should not execute)
      context.request = new Request('http://example.com/health');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);
    });

    it('should support regex paths', async () => {
      let executed = false;
      const middleware: Middleware = async (ctx, next) => {
        executed = true;
        return next();
      };

      const wrapped = skipPaths([/\.(js|css|png|jpg)$/], middleware);

      // Test /api/users (should execute)
      context.request = new Request('http://example.com/api/users');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, true);

      // Test /assets/style.css (should not execute)
      executed = false;
      context.request = new Request('http://example.com/assets/style.css');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);

      // Test /images/logo.png (should not execute)
      context.request = new Request('http://example.com/images/logo.png');
      await wrapped(context, async () => new Response('ok'));
      assert.strictEqual(executed, false);
    });
  });

  describe('Middleware transformations', () => {
    it('should allow middleware to transform responses', async () => {
      const addHeaderMiddleware: Middleware = async (ctx, next) => {
        const response = await next();
        const headers = new Headers(response.headers);
        headers.set('X-Custom-Header', 'test-value');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      };

      const response = await runMiddleware(
        [addHeaderMiddleware],
        context,
        async () => new Response('ok')
      );

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'test-value');
    });

    it('should allow middleware to modify request in context', async () => {
      const modifyRequestMiddleware: Middleware = async (ctx, next) => {
        const url = new URL(ctx.request.url);
        url.searchParams.set('modified', 'true');
        ctx.request = new Request(url.toString(), ctx.request);
        return next();
      };

      let finalRequest: Request | undefined;
      const captureRequestHandler = async () => {
        finalRequest = context.request;
        return new Response('ok');
      };

      await runMiddleware([modifyRequestMiddleware], context, captureRequestHandler);

      assert(finalRequest);
      const url = new URL(finalRequest.url);
      assert.strictEqual(url.searchParams.get('modified'), 'true');
    });
  });

  describe('Error handling', () => {
    it('should propagate errors through middleware chain', async () => {
      const middleware1: Middleware = async (ctx, next) => {
        try {
          return await next();
        } catch (error) {
          return new Response(`Caught: ${(error as Error).message}`, { status: 500 });
        }
      };

      const middleware2: Middleware = async (ctx, next) => {
        throw new Error('Test error');
      };

      const response = await runMiddleware(
        [middleware1, middleware2],
        context,
        async () => new Response('ok')
      );

      assert.strictEqual(response.status, 500);
      assert.strictEqual(await response.text(), 'Caught: Test error');
    });

    it('should handle async errors', async () => {
      const middleware: Middleware = async (ctx, next) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Async error');
      };

      await assert.rejects(
        runMiddleware([middleware], context, async () => new Response('ok')),
        /Async error/
      );
    });
  });
});
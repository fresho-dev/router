/**
 * @fileoverview Tests for CORS middleware.
 */

import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { MiddlewareContext } from '../middleware.js';
import { cors } from './cors.js';

describe('CORS Middleware', () => {
  let context: MiddlewareContext;
  let nextCalled: boolean;
  let nextResponse: Response;

  beforeEach(() => {
    nextCalled = false;
    nextResponse = new Response('test response');
    context = {
      request: new Request('http://example.com/test'),
      path: {},
      query: {},
      body: {},
      env: {},
    };
  });

  const next = async () => {
    nextCalled = true;
    return nextResponse;
  };

  describe('Preflight requests (OPTIONS)', () => {
    it('should handle preflight requests with default options', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
        },
      });

      const middleware = cors();
      const response = await middleware(context, next);

      assert.strictEqual(response.status, 204);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Methods'),
        'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
      );
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Headers'),
        'Content-Type, Authorization',
      );
      assert.strictEqual(response.headers.get('Access-Control-Max-Age'), '86400');
      assert.strictEqual(nextCalled, false);
    });

    it('should handle specific origin string', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({ origin: 'https://example.com' });
      const response = await middleware(context, next);

      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://example.com',
      );
    });

    it('should handle origin array', async () => {
      const allowedOrigins = ['https://example.com', 'https://app.example.com'];

      // Test allowed origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
        },
      });

      let middleware = cors({ origin: allowedOrigins });
      let response = await middleware(context, next);
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://example.com',
      );

      // Test disallowed origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.com',
        },
      });

      middleware = cors({ origin: allowedOrigins });
      response = await middleware(context, next);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), 'false');
    });

    it('should handle origin regex', async () => {
      const middleware = cors({ origin: /^https:\/\/.*\.example\.com$/ });

      // Test matching origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
        },
      });

      let response = await middleware(context, next);
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://app.example.com',
      );

      // Test non-matching origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.org',
        },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), 'false');
    });

    it('should handle origin function', async () => {
      const middleware = cors({
        origin: (origin) => origin.endsWith('.example.com'),
      });

      // Test allowed origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
        },
      });

      let response = await middleware(context, next);
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://app.example.com',
      );

      // Test disallowed origin
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.com',
        },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), 'false');
    });

    it('should handle credentials option', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({
        origin: 'https://example.com',
        credentials: true,
      });
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('Access-Control-Allow-Credentials'), 'true');
    });

    it('should handle custom methods and headers', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({
        methods: ['GET', 'POST'],
        allowedHeaders: ['X-Custom-Header'],
        exposedHeaders: ['X-Response-Header'],
      });
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('Access-Control-Allow-Methods'), 'GET, POST');
      assert.strictEqual(response.headers.get('Access-Control-Allow-Headers'), 'X-Custom-Header');
      assert.strictEqual(
        response.headers.get('Access-Control-Expose-Headers'),
        'X-Response-Header',
      );
    });

    it('should handle Access-Control-Request-Headers', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Headers': 'Content-Type, X-Custom',
        },
      });

      const middleware = cors({
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom'],
      });
      const response = await middleware(context, next);

      // Should only allow headers that are both requested and allowed
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Headers'),
        'content-type, x-custom',
      );
    });

    it('should handle preflightContinue option', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
        },
      });

      nextResponse = new Response('handler response', {
        headers: { 'X-Handler-Header': 'value' },
      });

      const middleware = cors({ preflightContinue: true });
      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response.headers.get('X-Handler-Header'), 'value');
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    });
  });

  describe('Actual requests (non-OPTIONS)', () => {
    it('should add CORS headers to response', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors();
      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
      assert.strictEqual(response.headers.get('Vary'), 'Origin');
    });

    it('should handle specific origin for actual requests', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({ origin: 'https://example.com' });
      const response = await middleware(context, next);

      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://example.com',
      );
    });

    it('should add credentials header when enabled', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({
        origin: 'https://example.com',
        credentials: true,
      });
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('Access-Control-Allow-Credentials'), 'true');
    });

    it('should not add credentials header with wildcard origin', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({
        origin: '*',
        credentials: true,
      });
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('Access-Control-Allow-Credentials'), null);
    });

    it('should expose headers when configured', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const middleware = cors({
        exposedHeaders: ['X-Total-Count', 'X-Page-Number'],
      });
      const response = await middleware(context, next);

      assert.strictEqual(
        response.headers.get('Access-Control-Expose-Headers'),
        'X-Total-Count, X-Page-Number',
      );
    });

    it('should preserve existing response headers', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      nextResponse = new Response('test', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'Content-Type': 'application/json',
        },
      });

      const middleware = cors();
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'custom-value');
      assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    });

    it('should handle requests without Origin header', async () => {
      context.request = new Request('http://example.com/test', {
        method: 'GET',
      });

      const middleware = cors({ origin: 'https://example.com' });
      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty configuration', async () => {
      const middleware = cors({});
      context.request = new Request('http://example.com/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });

      const response = await middleware(context, next);
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    });

    it('should handle various HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
      const middleware = cors();

      for (const method of methods) {
        context.request = new Request('http://example.com/test', {
          method,
          headers: {
            Origin: 'https://example.com',
          },
        });

        nextCalled = false;
        const response = await middleware(context, next);
        assert.strictEqual(nextCalled, true, `Should call next for ${method}`);
        assert.strictEqual(
          response.headers.get('Access-Control-Allow-Origin'),
          '*',
          `Should add CORS headers for ${method}`,
        );
      }
    });
  });
});

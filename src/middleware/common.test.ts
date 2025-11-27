/**
 * @fileoverview Tests for common middleware utilities.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  errorHandler,
  logger,
  rateLimit,
  MemoryRateLimitStore,
  requestId,
  timeout,
  contentType,
  type LogInfo,
} from './common.js';
import type { MiddlewareContext } from '../middleware.js';

describe('Common Middleware', () => {
  let context: MiddlewareContext;
  let nextCalled: boolean;
  let nextResponse: Response;

  beforeEach(() => {
    nextCalled = false;
    nextResponse = new Response('test response');
    context = {
      request: new Request('http://example.com/test'),
      params: { query: {}, body: {} },
      env: {},
    };
  });

  const next = async () => {
    nextCalled = true;
    return nextResponse;
  };

  describe('Error Handler', () => {
    it('should catch and handle errors', async () => {
      const middleware = errorHandler();

      const errorNext = async () => {
        throw new Error('Test error');
      };

      const response = await middleware(context, errorNext);

      assert.strictEqual(response.status, 500);
      const body = await response.json();
      assert.strictEqual(body.error, 'Internal Server Error');
    });

    it('should expose error details when configured', async () => {
      const middleware = errorHandler({ expose: true });

      const errorNext = async () => {
        throw new Error('Detailed error message');
      };

      const response = await middleware(context, errorNext);

      assert.strictEqual(response.status, 500);
      const body = await response.json();
      assert.strictEqual(body.error, 'Detailed error message');
      assert.strictEqual(body.name, 'Error');
      assert(body.stack);
    });

    it('should use custom status from error', async () => {
      const middleware = errorHandler({ expose: true });

      const errorNext = async () => {
        const error: any = new Error('Not found');
        error.status = 404;
        throw error;
      };

      const response = await middleware(context, errorNext);

      assert.strictEqual(response.status, 404);
      const body = await response.json();
      assert.strictEqual(body.error, 'Not found');
    });

    it('should use custom logger', async () => {
      let loggedError: Error | undefined;
      let loggedContext: MiddlewareContext | undefined;

      const middleware = errorHandler({
        log: async (error, ctx) => {
          loggedError = error;
          loggedContext = ctx;
        },
      });

      const errorNext = async () => {
        throw new Error('Test error');
      };

      await middleware(context, errorNext);

      assert(loggedError);
      assert.strictEqual(loggedError.message, 'Test error');
      assert.strictEqual(loggedContext, context);
    });

    it('should use custom formatter', async () => {
      const middleware = errorHandler({
        formatter: async (error) => {
          return new Response(
            JSON.stringify({ custom: error.message }),
            { status: 418, headers: { 'Content-Type': 'application/json' } }
          );
        },
      });

      const errorNext = async () => {
        throw new Error('Custom format');
      };

      const response = await middleware(context, errorNext);

      assert.strictEqual(response.status, 418);
      const body = await response.json();
      assert.strictEqual(body.custom, 'Custom format');
    });

    it('should pass through successful responses', async () => {
      const middleware = errorHandler();
      const response = await middleware(context, next);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(response.status, 200);
    });
  });

  describe('Logger', () => {
    it('should log requests and responses', async () => {
      const logs: string[] = [];
      const middleware = logger({
        log: (message) => logs.push(message),
      });

      nextResponse = new Response('test', { status: 200 });
      const response = await middleware(context, next);

      assert.strictEqual(logs.length, 2);
      assert(logs[0].includes('GET'));
      assert(logs[0].includes('/test'));
      assert(logs[1].includes('200'));
      assert(logs[1].includes('ms'));
    });

    it('should include headers when configured', async () => {
      let loggedInfo: LogInfo | undefined;
      const middleware = logger({
        includeHeaders: true,
        formatter: (info) => {
          loggedInfo = info;
          return JSON.stringify(info);
        },
        log: () => {},
      });

      context.request = new Request('http://example.com/test', {
        headers: {
          'User-Agent': 'Test Agent',
          'Accept': 'application/json',
        },
      });

      await middleware(context, next);

      assert(loggedInfo);
      assert(loggedInfo.headers);
      assert.strictEqual(loggedInfo.headers['user-agent'], 'Test Agent');
      assert.strictEqual(loggedInfo.headers['accept'], 'application/json');
    });

    it('should include body when configured', async () => {
      let loggedInfo: any;
      const middleware = logger({
        includeBody: true,
        formatter: (info) => {
          loggedInfo = info;
          return JSON.stringify(info);
        },
        log: () => {},
      });

      const body = { test: 'data' };
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      await middleware(context, next);

      assert.deepStrictEqual(loggedInfo.body, body);
    });

    it('should skip specified paths', async () => {
      const logs: string[] = [];
      const middleware = logger({
        log: (message) => logs.push(message),
        skipPaths: ['/health', /^\/metrics/],
      });

      // Test skipped path
      context.request = new Request('http://example.com/health');
      await middleware(context, next);
      assert.strictEqual(logs.length, 0);

      // Test normal path
      context.request = new Request('http://example.com/api');
      await middleware(context, next);
      assert.strictEqual(logs.length, 2);
    });

    it('should handle errors and log them', async () => {
      const logs: string[] = [];
      const middleware = logger({
        log: (message) => logs.push(message),
      });

      const errorNext = async () => {
        throw new Error('Request failed');
      };

      await assert.rejects(async () => middleware(context, errorNext), /Request failed/);

      assert.strictEqual(logs.length, 2);
      assert(logs[1].includes('500'));
      assert(logs[1].includes('Error'));
    });

    it('should use custom formatter', async () => {
      const logs: string[] = [];
      const middleware = logger({
        log: (message) => logs.push(message),
        formatter: (info) => `${info.method} ${info.url} -> ${info.status}`,
      });

      await middleware(context, next);

      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], 'GET /test -> 0');
      assert(logs[1].includes('-> 200'));
    });
  });

  describe('Rate Limiter', () => {
    it('should limit requests per window', async () => {
      const middleware = rateLimit({ max: 2, windowMs: 1000 });

      // First request - allowed
      let response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('X-RateLimit-Limit'), '2');
      assert.strictEqual(response.headers.get('X-RateLimit-Remaining'), '1');

      // Second request - allowed
      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('X-RateLimit-Remaining'), '0');

      // Third request - blocked
      nextCalled = false;
      response = await middleware(context, next);
      assert.strictEqual(response.status, 429);
      assert.strictEqual(await response.text(), 'Too many requests');
      assert.strictEqual(nextCalled, false);
      assert.strictEqual(response.headers.get('X-RateLimit-Remaining'), '0');
    });

    it('should use custom key generator', async () => {
      const middleware = rateLimit({
        max: 1,
        windowMs: 1000,
        keyGenerator: (ctx) => {
          const url = new URL(ctx.request.url);
          return url.pathname;
        },
      });

      // Same path - should be limited
      context.request = new Request('http://example.com/api');
      await middleware(context, next);

      context.request = new Request('http://example.com/api');
      let response = await middleware(context, next);
      assert.strictEqual(response.status, 429);

      // Different path - should be allowed
      context.request = new Request('http://example.com/other');
      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
    });

    it('should extract IP from various headers', async () => {
      const middleware = rateLimit({ max: 1, windowMs: 1000 });

      // Test CF-Connecting-IP
      context.request = new Request('http://example.com/test', {
        headers: { 'CF-Connecting-IP': '1.1.1.1' },
      });
      await middleware(context, next);

      // Same IP should be blocked
      let response = await middleware(context, next);
      assert.strictEqual(response.status, 429);

      // Different IP via X-Forwarded-For
      context.request = new Request('http://example.com/test', {
        headers: { 'X-Forwarded-For': '2.2.2.2, 3.3.3.3' },
      });
      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);

      // X-Real-IP
      context.request = new Request('http://example.com/test', {
        headers: { 'X-Real-IP': '4.4.4.4' },
      });
      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
    });

    it('should skip successful requests when configured', async () => {
      const middleware = rateLimit({
        max: 2,
        windowMs: 1000,
        skipSuccessfulRequests: true,
      });

      // Successful requests shouldn't count
      nextResponse = new Response('ok', { status: 200 });
      await middleware(context, next);
      await middleware(context, next);
      await middleware(context, next);

      // All should succeed
      assert.strictEqual(nextCalled, true);
    });

    it('should skip failed requests when configured', async () => {
      const middleware = rateLimit({
        max: 2,
        windowMs: 1000,
        skipFailedRequests: true,
      });

      // Failed requests shouldn't count
      nextResponse = new Response('error', { status: 500 });
      await middleware(context, next);
      await middleware(context, next);
      await middleware(context, next);

      // All should pass through
      assert.strictEqual(nextCalled, true);
    });

    it('should use custom handler', async () => {
      const middleware = rateLimit({
        max: 1,
        windowMs: 1000,
        handler: async () => new Response('Custom rate limit message', { status: 503 }),
      });

      await middleware(context, next);
      const response = await middleware(context, next);

      assert.strictEqual(response.status, 503);
      assert.strictEqual(await response.text(), 'Custom rate limit message');
    });
  });

  describe('MemoryRateLimitStore', () => {
    it('should track counts within window', async () => {
      const store = new MemoryRateLimitStore(1000);

      const count1 = await store.increment('key1');
      assert.strictEqual(count1, 1);

      const count2 = await store.increment('key1');
      assert.strictEqual(count2, 2);

      await store.decrement('key1');
      const count3 = await store.increment('key1');
      assert.strictEqual(count3, 2);
    });

    it('should reset counts after window', async () => {
      const store = new MemoryRateLimitStore(100);

      await store.increment('key1');
      await store.increment('key1');

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      const count = await store.increment('key1');
      assert.strictEqual(count, 1);
    });

    it('should handle reset', async () => {
      const store = new MemoryRateLimitStore(1000);

      await store.increment('key1');
      await store.increment('key1');
      await store.reset('key1');

      const count = await store.increment('key1');
      assert.strictEqual(count, 1);
    });
  });

  describe('Request ID', () => {
    it('should add request ID to context and response', async () => {
      const middleware = requestId();

      const response = await middleware(context, next);

      assert(context.requestId);
      assert.strictEqual(typeof context.requestId, 'string');
      assert.strictEqual(response.headers.get('X-Request-ID'), context.requestId);
    });

    it('should use custom header name', async () => {
      const middleware = requestId({ headerName: 'X-Trace-ID' });

      const response = await middleware(context, next);

      assert.strictEqual(response.headers.get('X-Trace-ID'), context.requestId);
    });

    it('should use existing request ID if present', async () => {
      const existingId = 'existing-123';
      const middleware = requestId();

      context.request = new Request('http://example.com/test', {
        headers: { 'X-Request-ID': existingId },
      });

      const response = await middleware(context, next);

      assert.strictEqual(context.requestId, existingId);
      assert.strictEqual(response.headers.get('X-Request-ID'), existingId);
    });

    it('should use custom generator', async () => {
      let counter = 0;
      const middleware = requestId({
        generator: () => `req-${++counter}`,
      });

      const response1 = await middleware(context, next);
      assert.strictEqual(response1.headers.get('X-Request-ID'), 'req-1');

      const response2 = await middleware(context, next);
      assert.strictEqual(response2.headers.get('X-Request-ID'), 'req-2');
    });
  });

  describe('Timeout', () => {
    it('should timeout long-running requests', async () => {
      const middleware = timeout({ timeout: 100 });

      const slowNext = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return new Response('should not reach');
      };

      const response = await middleware(context, slowNext);

      assert.strictEqual(response.status, 408);
      assert.strictEqual(await response.text(), 'Request timeout');
    });

    it('should not timeout fast requests', async () => {
      const middleware = timeout({ timeout: 100 });

      const fastNext = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response('success');
      };

      const response = await middleware(context, fastNext);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(await response.text(), 'success');
    });

    it('should use custom timeout message', async () => {
      const middleware = timeout({
        timeout: 50,
        message: 'Custom timeout',
      });

      const slowNext = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return new Response('should not reach');
      };

      const response = await middleware(context, slowNext);

      assert.strictEqual(response.status, 408);
      assert.strictEqual(await response.text(), 'Custom timeout');
    });

    it('should propagate non-timeout errors', async () => {
      const middleware = timeout({ timeout: 100 });

      const errorNext = async () => {
        throw new Error('Different error');
      };

      await assert.rejects(async () => middleware(context, errorNext), /Different error/);
    });
  });

  describe('Content Type', () => {
    it('should validate content type for applicable methods', async () => {
      const middleware = contentType({ types: ['application/json'] });

      // POST without content-type
      context.request = new Request('http://example.com/test', {
        method: 'POST',
      });

      let response = await middleware(context, next);
      assert.strictEqual(response.status, 415);

      // POST with wrong content-type
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.status, 415);

      // POST with correct content-type
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
    });

    it('should skip validation for GET, HEAD, OPTIONS by default', async () => {
      const middleware = contentType({ types: ['application/json'] });

      const methods = ['GET', 'HEAD', 'OPTIONS'];
      for (const method of methods) {
        context.request = new Request('http://example.com/test', { method });
        const response = await middleware(context, next);
        assert.strictEqual(response, nextResponse, `Should skip validation for ${method}`);
      }
    });

    it('should support multiple content types', async () => {
      const middleware = contentType({
        types: ['application/json', 'application/xml'],
      });

      // JSON content type
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      let response = await middleware(context, next);
      assert.strictEqual(response.status, 200);

      // XML content type
      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
      });

      response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
    });

    it('should handle content type with charset', async () => {
      const middleware = contentType({ types: ['application/json'] });

      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });

      const response = await middleware(context, next);
      assert.strictEqual(response.status, 200);
    });

    it('should use custom error message', async () => {
      const middleware = contentType({
        types: ['application/json'],
        message: 'JSON only!',
      });

      context.request = new Request('http://example.com/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
      });

      const response = await middleware(context, next);
      assert.strictEqual(await response.text(), 'JSON only!');
    });

    it('should allow custom skip methods', async () => {
      const middleware = contentType({
        types: ['application/json'],
        skipMethods: ['GET', 'DELETE'],
      });

      // DELETE should be skipped
      context.request = new Request('http://example.com/test', {
        method: 'DELETE',
      });

      let response = await middleware(context, next);
      assert.strictEqual(response.status, 200);

      // PUT should be validated
      context.request = new Request('http://example.com/test', {
        method: 'PUT',
      });

      response = await middleware(context, next);
      assert.strictEqual(response.status, 415);
    });
  });
});
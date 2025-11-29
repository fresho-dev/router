/**
 * @fileoverview Integration tests for middleware with routers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { router, route } from '../core.js';
import { createHandler } from '../handler.js';
import { cors, basicAuth, errorHandler, logger, requestId } from './index.js';
import type { Middleware } from '../middleware.js';

describe('Middleware Integration', () => {
  describe('Router with Middleware', () => {
    it('should apply middleware to all routes in a router', async () => {
      const logs: string[] = [];
      const loggingMiddleware: Middleware = async (ctx, next) => {
        logs.push(`Before: ${ctx.request.method} ${new URL(ctx.request.url).pathname}`);
        const response = await next();
        logs.push(`After: ${response.status}`);
        return response;
      };

      const apiRouter = router(
        '/api',
        {
          users: route({
            method: 'get',
            path: '/users',
            handler: async () => Response.json({ users: [] }),
          }),
          posts: route({
            method: 'get',
            path: '/posts',
            handler: async () => Response.json({ posts: [] }),
          }),
        },
        loggingMiddleware
      );

      const handler = createHandler(apiRouter);

      // Test /api/users
      await handler(new Request('http://example.com/api/users'));
      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], 'Before: GET /api/users');
      assert.strictEqual(logs[1], 'After: 200');

      // Test /api/posts
      logs.length = 0;
      await handler(new Request('http://example.com/api/posts'));
      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], 'Before: GET /api/posts');
      assert.strictEqual(logs[1], 'After: 200');
    });

    it('should compose middleware from nested routers', async () => {
      const order: string[] = [];

      const globalMiddleware: Middleware = async (ctx, next) => {
        order.push('global-before');
        const response = await next();
        order.push('global-after');
        return response;
      };

      const apiMiddleware: Middleware = async (ctx, next) => {
        order.push('api-before');
        const response = await next();
        order.push('api-after');
        return response;
      };

      const v1Middleware: Middleware = async (ctx, next) => {
        order.push('v1-before');
        const response = await next();
        order.push('v1-after');
        return response;
      };

      const v1Router = router(
        '/v1',
        {
          users: route({
            method: 'get',
            path: '/users',
            handler: async (c) => {
              order.push('handler');
              return Response.json({ version: 'v1' });
            },
          }),
        },
        v1Middleware
      );

      const apiRouter = router(
        '/api',
        {
          v1: v1Router,
        },
        apiMiddleware
      );

      const mainRouter = router(
        '/',
        {
          api: apiRouter,
        },
        globalMiddleware
      );

      const handler = createHandler(mainRouter);
      const response = await handler(new Request('http://example.com/api/v1/users'));

      // Check that we got a valid response
      assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}: ${await response.text()}`);

      assert.deepStrictEqual(order, [
        'global-before',
        'api-before',
        'v1-before',
        'handler',
        'v1-after',
        'api-after',
        'global-after',
      ]);
    });
  });

  describe('CORS Integration', () => {
    it('should handle CORS for all routes', async () => {
      const apiRouter = router(
        '/api',
        {
          data: route({
            method: 'get',
            path: '/data',
            handler: async () => Response.json({ data: 'test' }),
          }),
        },
        cors({ origin: 'https://example.com', credentials: true })
      );

      const handler = createHandler(apiRouter);

      // Test preflight
      const preflightResponse = await handler(
        new Request('http://localhost/api/data', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://example.com',
          },
        })
      );

      assert.strictEqual(preflightResponse.status, 204);
      assert.strictEqual(
        preflightResponse.headers.get('Access-Control-Allow-Origin'),
        'https://example.com'
      );
      assert.strictEqual(
        preflightResponse.headers.get('Access-Control-Allow-Credentials'),
        'true'
      );

      // Test actual request
      const response = await handler(
        new Request('http://localhost/api/data', {
          headers: {
            'Origin': 'https://example.com',
          },
        })
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('Access-Control-Allow-Origin'),
        'https://example.com'
      );
    });
  });

  describe('Authentication Integration', () => {
    it('should protect routes with basic auth', async () => {
      const adminRouter = router(
        '/admin',
        {
          users: route({
            method: 'get',
            path: '/users',
            handler: async (c) => {
              // Basic auth middleware sets the user, accessible via context
              return Response.json({ admin: true });
            },
          }),
        },
        basicAuth({
          verify: async (username, password) => {
            if (username === 'admin' && password === 'secret') {
              return { user: username };
            }
            return null;
          },
        })
      );

      const handler = createHandler(adminRouter);

      // Test without credentials
      let response = await handler(new Request('http://localhost/admin/users'));
      assert.strictEqual(response.status, 401);
      assert.strictEqual(
        response.headers.get('WWW-Authenticate'),
        'Basic realm="Secure Area", charset="UTF-8"'
      );

      // Test with invalid credentials
      const invalidAuth = btoa('admin:wrong');
      response = await handler(
        new Request('http://localhost/admin/users', {
          headers: {
            'Authorization': `Basic ${invalidAuth}`,
          },
        })
      );
      assert.strictEqual(response.status, 401);

      // Test with valid credentials
      const validAuth = btoa('admin:secret');
      response = await handler(
        new Request('http://localhost/admin/users', {
          headers: {
            'Authorization': `Basic ${validAuth}`,
          },
        })
      );
      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.admin, true);
    });

    it('should handle mixed public and protected routes', async () => {
      const publicRouter = router('/public', {
        health: route({
          method: 'get',
          path: '/health',
          handler: async () => Response.json({ status: 'ok' }),
        }),
      });

      const protectedRouter = router(
        '/protected',
        {
          data: route({
            method: 'get',
            path: '/data',
            handler: async () => Response.json({ secret: 'data' }),
          }),
        },
        basicAuth({
          verify: async () => ({ authenticated: true }),
        })
      );

      const mainRouter = router('/', {
        public: publicRouter,
        protected: protectedRouter,
      });

      const handler = createHandler(mainRouter);

      // Public route should work without auth
      const publicResponse = await handler(new Request('http://localhost/public/health'));
      assert.strictEqual(publicResponse.status, 200);

      // Protected route should require auth
      const protectedResponse = await handler(new Request('http://localhost/protected/data'));
      assert.strictEqual(protectedResponse.status, 401);
    });
  });

  describe('Error Handling Integration', () => {
    it('should catch errors at router level', async () => {
      const apiRouter = router(
        '/api',
        {
          broken: route({
            method: 'get',
            path: '/broken',
            handler: async () => {
              throw new Error('Something broke');
            },
          }),
          working: route({
            method: 'get',
            path: '/working',
            handler: async () => Response.json({ ok: true }),
          }),
        },
        errorHandler({ expose: false })
      );

      const handler = createHandler(apiRouter);

      // Test error route
      const errorResponse = await handler(new Request('http://localhost/api/broken'));
      assert.strictEqual(errorResponse.status, 500);
      const errorBody = await errorResponse.json();
      assert.strictEqual(errorBody.error, 'Internal Server Error');

      // Test working route
      const okResponse = await handler(new Request('http://localhost/api/working'));
      assert.strictEqual(okResponse.status, 200);
    });
  });

  describe('Multiple Middleware Composition', () => {
    it('should compose multiple middleware correctly', async () => {
      const apiRouter = router(
        '/api',
        {
          data: route({
            method: 'post',
            path: '/data',
            handler: async () => Response.json({ success: true }),
          }),
        },
        errorHandler(),
        cors({ origin: '*' }),
        requestId(),
        basicAuth({
          verify: async (u, p) => {
            if (u === 'user' && p === 'pass') {
              return { user: u };
            }
            return null;
          },
        })
      );

      const handler = createHandler(apiRouter);

      // Test with valid auth
      const validAuth = btoa('user:pass');
      const response = await handler(
        new Request('http://localhost/api/data', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${validAuth}`,
            'Origin': 'https://app.example.com',
          },
          body: JSON.stringify({ test: 'data' }),
        })
      );

      assert.strictEqual(response.status, 200);
      assert(response.headers.get('X-Request-ID'));
      assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
      const body = await response.json();
      assert.strictEqual(body.success, true);
    });

    it('should maintain correct middleware order across nesting', async () => {
      const events: string[] = [];

      const createTrackerMiddleware = (name: string): Middleware => {
        return async (ctx, next) => {
          events.push(`${name}:enter`);
          try {
            const response = await next();
            events.push(`${name}:exit:${response.status}`);
            return response;
          } catch (error) {
            events.push(`${name}:error`);
            throw error;
          }
        };
      };

      const v2Router = router(
        '/v2',
        {
          resource: route({
            method: 'get',
            path: '/resource',
            handler: async () => {
              events.push('handler');
              return Response.json({ version: 2 });
            },
          }),
        },
        createTrackerMiddleware('v2')
      );

      const apiRouter = router(
        '/api',
        {
          v2: v2Router,
        },
        createTrackerMiddleware('api')
      );

      const mainRouter = router(
        '/',
        {
          api: apiRouter,
        },
        createTrackerMiddleware('main')
      );

      const handler = createHandler(mainRouter);
      await handler(new Request('http://localhost/api/v2/resource'));

      assert.deepStrictEqual(events, [
        'main:enter',
        'api:enter',
        'v2:enter',
        'handler',
        'v2:exit:200',
        'api:exit:200',
        'main:exit:200',
      ]);
    });
  });

  describe('Context Propagation', () => {
    it('should propagate context through middleware chain', async () => {
      // Test context propagation between middleware
      const contextValues: any = {};

      const addUserMiddleware: Middleware = async (ctx, next) => {
        ctx.user = { id: '123', name: 'Test User' };
        return next();
      };

      const checkUserMiddleware: Middleware = async (ctx, next) => {
        // Verify that previous middleware added user to context
        contextValues.hasUser = !!ctx.user;
        contextValues.userId = (ctx.user as any)?.id;
        ctx.permissions = ['read', 'write'];
        return next();
      };

      const checkAllMiddleware: Middleware = async (ctx, next) => {
        // Verify both previous middleware ran
        contextValues.hasPermissions = !!ctx.permissions;
        const response = await next();
        // Add headers to prove middleware ran
        const headers = new Headers(response.headers);
        headers.set('X-User-Id', (ctx.user as any)?.id || 'none');
        headers.set('X-Permissions', JSON.stringify(ctx.permissions || []));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      };

      const apiRouter = router(
        '/api',
        {
          profile: route({
            method: 'get',
            path: '/profile',
            handler: async () => {
              return Response.json({ message: 'profile' });
            },
          }),
        },
        addUserMiddleware, checkUserMiddleware, checkAllMiddleware
      );

      const handler = createHandler(apiRouter);
      const response = await handler(new Request('http://localhost/api/profile'));

      assert.strictEqual(response.status, 200);
      // Check that context was propagated through middleware
      assert.strictEqual(contextValues.hasUser, true);
      assert.strictEqual(contextValues.userId, '123');
      assert.strictEqual(contextValues.hasPermissions, true);
      // Check headers added by last middleware
      assert.strictEqual(response.headers.get('X-User-Id'), '123');
      assert.strictEqual(response.headers.get('X-Permissions'), '["read","write"]');
    });
  });

  describe('Middleware with Schema Validation', () => {
    it('should run middleware before and after schema validation', async () => {
      const events: string[] = [];

      const trackingMiddleware: Middleware = async (ctx, next) => {
        events.push('middleware:before');
        const response = await next();
        events.push('middleware:after');
        return response;
      };

      const apiRouter = router(
        '/api',
        {
          users: route({
            method: 'post',
            path: '/users',
            body: {
              name: 'string',
              age: 'number',
            },
            handler: async (c) => {
              events.push('handler');
              return Response.json(c.body);
            },
          }),
        },
        trackingMiddleware
      );

      const handler = createHandler(apiRouter);

      // Valid request
      events.length = 0;
      let response = await handler(
        new Request('http://localhost/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'John', age: 30 }),
        })
      );

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(events, ['middleware:before', 'handler', 'middleware:after']);

      // Invalid request (schema validation fails)
      events.length = 0;
      response = await handler(
        new Request('http://localhost/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'John' }), // Missing age
        })
      );

      assert.strictEqual(response.status, 400);
      // Middleware runs but handler doesn't due to validation failure
      assert.deepStrictEqual(events, ['middleware:before', 'middleware:after']);
    });
  });

  describe('Middleware Short-circuiting', () => {
    it('should allow middleware to short-circuit the chain', async () => {
      const executed: string[] = [];

      const authMiddleware: Middleware = async (ctx, next) => {
        executed.push('auth');
        const authHeader = ctx.request.headers.get('Authorization');
        if (!authHeader) {
          return new Response('Unauthorized', { status: 401 });
        }
        return next();
      };

      const loggingMiddleware: Middleware = async (ctx, next) => {
        executed.push('logging');
        return next();
      };

      const apiRouter = router(
        '/api',
        {
          data: route({
            method: 'get',
            path: '/data',
            handler: async () => {
              executed.push('handler');
              return Response.json({ data: 'secret' });
            },
          }),
        },
        authMiddleware, loggingMiddleware
      );

      const handler = createHandler(apiRouter);

      // Request without auth - should short-circuit
      executed.length = 0;
      let response = await handler(new Request('http://localhost/api/data'));
      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(executed, ['auth']); // logging and handler not executed

      // Request with auth - should proceed
      executed.length = 0;
      response = await handler(
        new Request('http://localhost/api/data', {
          headers: { 'Authorization': 'Bearer token' },
        })
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(executed, ['auth', 'logging', 'handler']);
    });
  });

  describe('Typed Middleware', () => {
    it('should accept typed middleware without casting', async () => {
      // This test verifies that typed middleware can be passed to router
      // without needing "as any" casts. This is a compile-time check.
      interface AuthEnv {
        JWT_SECRET: string;
      }

      interface AuthContext {
        env: AuthEnv;
        user: { id: string };
      }

      // Create typed middleware.
      const typedMiddleware: Middleware<AuthContext> = async (ctx, next) => {
        // ctx.env.JWT_SECRET is typed
        ctx.user = { id: 'user-123' };
        return next();
      };

      // This should compile without "as any" cast - using rest parameters.
      const apiRouter = router(
        '/api',
        {
          profile: route.ctx<AuthContext>()({
            method: 'get',
            path: '/profile',
            handler: async (c) => Response.json({ userId: c.user.id }),
          }),
        },
        typedMiddleware  // No array, no cast needed!
      );

      const handler = createHandler(apiRouter);
      const response = await handler(
        new Request('http://localhost/api/profile'),
        { JWT_SECRET: 'secret' }
      );

      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.userId, 'user-123');
    });
  });
});
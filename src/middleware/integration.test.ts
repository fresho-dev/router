/**
 * @fileoverview Integration tests for middleware with routers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { router, route } from '../core.js';
import { createHandler } from '../handler.js';
import { cors, basicAuth, errorHandler, logger, requestId, jwtAuth, jwtSign } from './index.js';
import { createHttpClient } from '../http-client.js';
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

  describe('JWT End-to-End with HTTP Client', () => {
    // This test demonstrates the complete JWT workflow from the client's perspective,
    // as documented in docs/middleware.md. The client experience is transparent:
    // sign a token, configure the client, call typed methods.

    const JWT_SECRET = 'test-secret-key';

    // Define user type for the API.
    interface User {
      id: string;
      email: string;
      role: 'admin' | 'user';
    }

    interface AppContext {
      user: User;
    }

    // Create the protected API.
    const api = router(
      '/api',
      {
        // Public endpoint - no auth required.
        health: route({
          method: 'get',
          path: '/health',
          handler: async () => ({ status: 'ok' }),
        }),

        // Protected endpoint - requires JWT with user context.
        profile: route.ctx<AppContext>()({
          method: 'get',
          path: '/profile',
          query: { include: 'string?' },
          handler: async (c) => ({
            id: c.user.id,
            email: c.user.email,
            role: c.user.role,
            include: c.query.include,
          }),
        }),

        // Protected endpoint with POST body.
        updateProfile: route.ctx<AppContext>()({
          method: 'post',
          path: '/profile',
          body: { displayName: 'string' },
          handler: async (c) => ({
            id: c.user.id,
            displayName: c.body.displayName,
            updatedBy: c.user.email,
          }),
        }),
      },
      jwtAuth({
        secret: JWT_SECRET,
        claims: (payload) => ({
          user: {
            id: payload.sub as string,
            email: payload.email as string,
            role: payload.role as 'admin' | 'user',
          },
        }),
      })
    );

    it('should allow authenticated requests via HTTP client (end-to-end)', async () => {
      // Step 1: Sign a JWT token (typically done on login).
      const token = await jwtSign(
        { email: 'alice@example.com', role: 'admin' },
        JWT_SECRET,
        { expiresIn: '1h', subject: 'user-123' }
      );

      // Step 2: Create HTTP server using Node's createServer.
      const { createServer } = await import('node:http');
      const handler = createHandler(api);

      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const body = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => resolve(data));
        });
        const request = new Request(url.toString(), {
          method: req.method,
          headers,
          body: ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? body : undefined,
        });
        const response = await handler(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });

      try {
        // Step 3: Configure the HTTP client with the token.
        const client = createHttpClient(api);
        client.configure({
          baseUrl: `http://localhost:${port}`,
          headers: { Authorization: `Bearer ${token}` },
        });

        // Step 4: Make authenticated requests - fully typed!
        const profile = await client.profile({ query: { include: 'settings' } });

        // Response is fully typed: { id: string, email: string, role: 'admin' | 'user', include: string | undefined }
        assert.strictEqual(profile.id, 'user-123');
        assert.strictEqual(profile.email, 'alice@example.com');
        assert.strictEqual(profile.role, 'admin');
        assert.strictEqual(profile.include, 'settings');

        // Step 5: Test POST with body.
        const updated = await client.updateProfile({
          body: { displayName: 'Alice Smith' },
        });

        assert.strictEqual(updated.id, 'user-123');
        assert.strictEqual(updated.displayName, 'Alice Smith');
        assert.strictEqual(updated.updatedBy, 'alice@example.com');
      } finally {
        server.close();
      }
    });

    it('should reject unauthenticated requests via HTTP client', async () => {
      const { createServer } = await import('node:http');
      const handler = createHandler(api);

      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const request = new Request(url.toString(), { method: req.method, headers });
        const response = await handler(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });

      try {
        const client = createHttpClient(api);
        client.configure({
          baseUrl: `http://localhost:${port}`,
          // No Authorization header.
        });

        // Unauthenticated request should throw.
        await assert.rejects(
          async () => client.profile({}),
          (error: Error) => {
            // HTTP client throws on non-2xx status.
            assert.ok(
              error.message.includes('401') || error.message.includes('Unauthorized') || error.message.includes('Missing token'),
              `Expected error about 401/unauthorized, got: ${error.message}`
            );
            return true;
          }
        );
      } finally {
        server.close();
      }
    });

    it('should allow authenticated requests via handler directly (no HTTP)', async () => {
      // For tests without HTTP overhead, call the handler directly with a Request.
      const token = await jwtSign(
        { email: 'bob@example.com', role: 'user' },
        JWT_SECRET,
        { expiresIn: '1h', subject: 'user-456' }
      );

      const handler = createHandler(api);

      // Make authenticated request directly.
      const response = await handler(
        new Request('http://localhost/api/profile?include=prefs', {
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      assert.strictEqual(response.status, 200);
      const profile = await response.json() as { id: string; email: string; role: string; include?: string };

      assert.strictEqual(profile.id, 'user-456');
      assert.strictEqual(profile.email, 'bob@example.com');
      assert.strictEqual(profile.role, 'user');
      assert.strictEqual(profile.include, 'prefs');
    });

    it('should reject expired tokens', async () => {
      // Create an already-expired token.
      const expiredToken = await jwtSign(
        { email: 'expired@example.com', role: 'user' },
        JWT_SECRET,
        {
          expiresIn: -3600, // Expired 1 hour ago.
          subject: 'user-expired',
        }
      );

      const handler = createHandler(api);

      const response = await handler(
        new Request('http://localhost/api/profile', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        })
      );

      assert.strictEqual(response.status, 401);
      const body = await response.text();
      assert.ok(body.includes('expired'));
    });

    it('should support per-request headers for JWT authentication', async () => {
      // This test demonstrates the pattern from the docs where you pass
      // the Authorization header per-request instead of globally.
      const token = await jwtSign(
        { email: 'charlie@example.com', role: 'user' },
        JWT_SECRET,
        { expiresIn: '1h', subject: 'user-789' }
      );

      const { createServer } = await import('node:http');
      const handler = createHandler(api);

      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const body = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk) => (data += chunk));
          req.on('end', () => resolve(data));
        });
        const request = new Request(url.toString(), {
          method: req.method,
          headers,
          body: ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? body : undefined,
        });
        const response = await handler(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
      });

      try {
        const client = createHttpClient(api);
        // Only configure baseUrl, not headers.
        client.configure({ baseUrl: `http://localhost:${port}` });

        // Pass Authorization header per-request.
        const profile = await client.profile({
          query: { include: 'settings' },
          headers: { Authorization: `Bearer ${token}` },
        });

        assert.strictEqual(profile.id, 'user-789');
        assert.strictEqual(profile.email, 'charlie@example.com');
        assert.strictEqual(profile.role, 'user');
        assert.strictEqual(profile.include, 'settings');

        // Also works for POST requests with per-request headers.
        const updated = await client.updateProfile({
          body: { displayName: 'Charlie Brown' },
          headers: { Authorization: `Bearer ${token}` },
        });

        assert.strictEqual(updated.id, 'user-789');
        assert.strictEqual(updated.displayName, 'Charlie Brown');
      } finally {
        server.close();
      }
    });
  });
});
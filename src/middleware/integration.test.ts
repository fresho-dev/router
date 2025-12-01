/**
 * @fileoverview Integration tests for middleware with routers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { router, route } from '../core.js';
import { createHandler } from '../handler.js';
import { cors, basicAuth, errorHandler, requestId, jwtAuth, jwtSign } from './index.js';
import { createHttpClient } from '../http-client.js';
import type { Middleware } from '../middleware.js';
import type { FetchHandler } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

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
        {
          users: router({
            get: async () => Response.json({ users: [] }),
          }),
          posts: router({
            get: async () => Response.json({ posts: [] }),
          }),
        },
        loggingMiddleware
      );

      const handler = createHandler(apiRouter);

      // Test /users
      await handler(new Request('http://example.com/users'));
      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], 'Before: GET /users');
      assert.strictEqual(logs[1], 'After: 200');

      // Test /posts
      logs.length = 0;
      await handler(new Request('http://example.com/posts'));
      assert.strictEqual(logs.length, 2);
      assert.strictEqual(logs[0], 'Before: GET /posts');
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
        {
          users: router({
            get: async () => {
              order.push('handler');
              return Response.json({ version: 'v1' });
            },
          }),
        },
        v1Middleware
      );

      const apiRouter = router(
        {
          v1: v1Router,
        },
        apiMiddleware
      );

      const mainRouter = router(
        {
          api: apiRouter,
        },
        globalMiddleware
      );

      const handler = createHandler(mainRouter);
      const response = await handler(new Request('http://example.com/api/v1/users'));

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
        {
          data: router({
            get: async () => Response.json({ data: 'test' }),
          }),
        },
        cors({ origin: 'https://example.com', credentials: true })
      );

      const handler = createHandler(apiRouter);

      // Test preflight
      const preflightResponse = await handler(
        new Request('http://localhost/data', {
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
        new Request('http://localhost/data', {
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
        {
          users: router({
            get: async () => Response.json({ admin: true }),
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
      let response = await handler(new Request('http://localhost/users'));
      assert.strictEqual(response.status, 401);
      assert.strictEqual(
        response.headers.get('WWW-Authenticate'),
        'Basic realm="Secure Area", charset="UTF-8"'
      );

      // Test with invalid credentials
      const invalidAuth = btoa('admin:wrong');
      response = await handler(
        new Request('http://localhost/users', {
          headers: {
            'Authorization': `Basic ${invalidAuth}`,
          },
        })
      );
      assert.strictEqual(response.status, 401);

      // Test with valid credentials
      const validAuth = btoa('admin:secret');
      response = await handler(
        new Request('http://localhost/users', {
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
      const publicRouter = router({
        health: router({
          get: async () => Response.json({ status: 'ok' }),
        }),
      });

      const protectedRouter = router(
        {
          data: router({
            get: async () => Response.json({ secret: 'data' }),
          }),
        },
        basicAuth({
          verify: async () => ({ authenticated: true }),
        })
      );

      const mainRouter = router({
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
        {
          broken: router({
            get: async () => {
              throw new Error('Something broke');
            },
          }),
          working: router({
            get: async () => Response.json({ ok: true }),
          }),
        },
        errorHandler({ expose: false })
      );

      const handler = createHandler(apiRouter);

      // Test error route
      const errorResponse = await handler(new Request('http://localhost/broken'));
      assert.strictEqual(errorResponse.status, 500);
      const errorBody = await errorResponse.json();
      assert.strictEqual(errorBody.error, 'Internal Server Error');

      // Test working route
      const okResponse = await handler(new Request('http://localhost/working'));
      assert.strictEqual(okResponse.status, 200);
    });
  });

  describe('Multiple Middleware Composition', () => {
    it('should compose multiple middleware correctly', async () => {
      const apiRouter = router(
        {
          data: router({
            post: async () => Response.json({ success: true }),
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
        new Request('http://localhost/data', {
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
        {
          resource: router({
            get: async () => {
              events.push('handler');
              return Response.json({ version: 2 });
            },
          }),
        },
        createTrackerMiddleware('v2')
      );

      const apiRouter = router(
        {
          v2: v2Router,
        },
        createTrackerMiddleware('api')
      );

      const mainRouter = router(
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contextValues: any = {};

      const addUserMiddleware: Middleware = async (ctx, next) => {
        ctx.user = { id: '123', name: 'Test User' };
        return next();
      };

      const checkUserMiddleware: Middleware = async (ctx, next) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contextValues.hasUser = !!ctx.user;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        contextValues.userId = (ctx.user as any)?.id;
        ctx.permissions = ['read', 'write'];
        return next();
      };

      const checkAllMiddleware: Middleware = async (ctx, next) => {
        contextValues.hasPermissions = !!ctx.permissions;
        const response = await next();
        const headers = new Headers(response.headers);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers.set('X-User-Id', (ctx.user as any)?.id || 'none');
        headers.set('X-Permissions', JSON.stringify(ctx.permissions || []));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      };

      const apiRouter = router(
        {
          profile: router({
            get: async () => Response.json({ message: 'profile' }),
          }),
        },
        addUserMiddleware, checkUserMiddleware, checkAllMiddleware
      );

      const handler = createHandler(apiRouter);
      const response = await handler(new Request('http://localhost/profile'));

      assert.strictEqual(response.status, 200);
      assert.strictEqual(contextValues.hasUser, true);
      assert.strictEqual(contextValues.userId, '123');
      assert.strictEqual(contextValues.hasPermissions, true);
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
        {
          users: router({
            post: route({
              body: {
                name: 'string',
                age: 'number',
              },
              handler: async (c) => {
                events.push('handler');
                return Response.json(c.body);
              },
            }),
          }),
        },
        trackingMiddleware
      );

      const handler = createHandler(apiRouter);

      // Valid request
      events.length = 0;
      let response = await handler(
        new Request('http://localhost/users', {
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
        new Request('http://localhost/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'John' }), // Missing age
        })
      );

      assert.strictEqual(response.status, 400);
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
        {
          data: router({
            get: async () => {
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
      let response = await handler(new Request('http://localhost/data'));
      assert.strictEqual(response.status, 401);
      assert.deepStrictEqual(executed, ['auth']);

      // Request with auth - should proceed
      executed.length = 0;
      response = await handler(
        new Request('http://localhost/data', {
          headers: { 'Authorization': 'Bearer token' },
        })
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(executed, ['auth', 'logging', 'handler']);
    });
  });

  describe('Typed Middleware', () => {
    it('should accept typed middleware without casting', async () => {
      interface AuthEnv {
        JWT_SECRET: string;
      }

      interface AuthContext {
        env: AuthEnv;
        user: { id: string };
      }

      const typedMiddleware: Middleware<AuthContext> = async (ctx, next) => {
        ctx.user = { id: 'user-123' };
        return next();
      };

      const apiRouter = router(
        {
          profile: router({
            get: route.ctx<AuthContext>()({
              handler: async (c) => Response.json({ userId: c.user.id }),
            }),
          }),
        },
        typedMiddleware
      );

      const handler = createHandler(apiRouter);
      const response = await handler(
        new Request('http://localhost/profile'),
        { JWT_SECRET: 'secret' }
      );

      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.userId, 'user-123');
    });
  });

  describe('JWT End-to-End with Both Clients', () => {
    async function withServer(
      handler: FetchHandler,
      fn: (port: number) => Promise<void>
    ): Promise<void> {
      const { createServer } = await import('node:http');

      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const body = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk: Buffer) => (data += chunk));
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
        await fn(port);
      } finally {
        server.close();
      }
    }

    const JWT_SECRET = 'test-secret-key';

    interface User {
      id: string;
      email: string;
      role: 'admin' | 'user';
    }

    interface AppContext {
      user: User;
    }

    const api = router(
      {
        health: router({
          get: async () => ({ status: 'ok' }),
        }),

        profile: router({
          get: route.ctx<AppContext>()({
            query: { include: 'string?' },
            handler: async (c) => ({
              id: c.user.id,
              email: c.user.email,
              role: c.user.role,
              include: c.query.include,
            }),
          }),
        }),

        updateProfile: router({
          post: route.ctx<AppContext>()({
            body: { displayName: 'string' },
            handler: async (c) => ({
              id: c.user.id,
              displayName: c.body.displayName,
              updatedBy: c.user.email,
            }),
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

    const handler = createHandler(api);

    describe('localClient', () => {
      it('should allow authenticated requests', async () => {
        const token = await jwtSign(
          { email: 'alice@example.com', role: 'admin' },
          JWT_SECRET,
          { expiresIn: '1h', subject: 'user-123' }
        );

        const response = await handler(
          new Request('http://localhost/profile?include=settings', {
            headers: { Authorization: `Bearer ${token}` },
          })
        );

        assert.strictEqual(response.status, 200);
        const profile = (await response.json()) as {
          id: string;
          email: string;
          role: string;
          include?: string;
        };

        assert.strictEqual(profile.id, 'user-123');
        assert.strictEqual(profile.email, 'alice@example.com');
        assert.strictEqual(profile.role, 'admin');
        assert.strictEqual(profile.include, 'settings');
      });

      it('should reject unauthenticated requests', async () => {
        const response = await handler(new Request('http://localhost/profile'));
        assert.strictEqual(response.status, 401);
      });
    });

    describe('httpClient', () => {
      it('should allow authenticated requests (end-to-end)', async () => {
        const token = await jwtSign(
          { email: 'alice@example.com', role: 'admin' },
          JWT_SECRET,
          { expiresIn: '1h', subject: 'user-123' }
        );

        await withServer(handler, async (port) => {
          const client: AnyClient = createHttpClient({
            baseUrl: `http://localhost:${port}`,
            headers: { Authorization: `Bearer ${token}` },
          });

          const profile = await client.profile({ query: { include: 'settings' } });
          const typed = profile as { id: string; email: string; role: string; include?: string };

          assert.strictEqual(typed.id, 'user-123');
          assert.strictEqual(typed.email, 'alice@example.com');
          assert.strictEqual(typed.role, 'admin');
          assert.strictEqual(typed.include, 'settings');

          const updated = await client.updateProfile.post({
            body: { displayName: 'Alice Smith' },
          });
          const typedUpdate = updated as { id: string; displayName: string; updatedBy: string };

          assert.strictEqual(typedUpdate.id, 'user-123');
          assert.strictEqual(typedUpdate.displayName, 'Alice Smith');
          assert.strictEqual(typedUpdate.updatedBy, 'alice@example.com');
        });
      });

      it('should reject unauthenticated requests', async () => {
        await withServer(handler, async (port) => {
          const client: AnyClient = createHttpClient({
            baseUrl: `http://localhost:${port}`,
          });

          await assert.rejects(
            async () => client.profile(),
            (error: Error) => {
              assert.ok(
                error.message.includes('401') ||
                  error.message.includes('Unauthorized') ||
                  error.message.includes('Missing token'),
                `Expected error about 401/unauthorized, got: ${error.message}`
              );
              return true;
            }
          );
        });
      });

      it('should support per-request headers', async () => {
        const token = await jwtSign(
          { email: 'charlie@example.com', role: 'user' },
          JWT_SECRET,
          { expiresIn: '1h', subject: 'user-789' }
        );

        await withServer(handler, async (port) => {
          const client: AnyClient = createHttpClient({
            baseUrl: `http://localhost:${port}`,
          });

          const profile = await client.profile({
            query: { include: 'settings' },
            headers: { Authorization: `Bearer ${token}` },
          });
          const typed = profile as { id: string; email: string; role: string; include?: string };

          assert.strictEqual(typed.id, 'user-789');
          assert.strictEqual(typed.email, 'charlie@example.com');
          assert.strictEqual(typed.include, 'settings');
        });
      });
    });

    it('should reject expired tokens', async () => {
      const expiredToken = await jwtSign(
        { email: 'expired@example.com', role: 'user' },
        JWT_SECRET,
        { expiresIn: -3600, subject: 'user-expired' }
      );

      const response = await handler(
        new Request('http://localhost/profile', {
          headers: { Authorization: `Bearer ${expiredToken}` },
        })
      );

      assert.strictEqual(response.status, 401);
      const body = await response.text();
      assert.ok(body.includes('expired'));
    });
  });
});

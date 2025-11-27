/**
 * @fileoverview Hono adapter for typed-routes.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Hono } from 'hono';
import {
  type RouteDefinition,
  type Router,
  type RouterRoutes,
  type ExecutionContext,
  compileSchema,
  isRouter,
  isRoute,
} from './index.js';
import type { Middleware, MiddlewareContext } from './middleware.js';
import { runMiddleware } from './middleware.js';

/** Creates a Hono middleware that validates and calls the route handler. */
function createHonoHandler(routeDef: RouteDefinition, middleware: Middleware[] = []): MiddlewareHandler {
  const querySchema = routeDef.query ? compileSchema(routeDef.query) : null;
  const bodySchema = routeDef.body ? compileSchema(routeDef.body) : null;

  return async (c: Context) => {
    // Get execution context if available (Cloudflare Workers only).
    let executionCtx: ExecutionContext | undefined;
    try {
      executionCtx = c.executionCtx;
    } catch {
      // Not in a Cloudflare Workers environment.
    }

    // Create middleware context with empty params initially.
    const context: MiddlewareContext = {
      request: c.req.raw,
      params: { query: {}, body: {} },
      env: c.env,
      ctx: executionCtx,
    };

    // Run middleware chain with validation and handler as final step.
    // Always run if there's middleware, handler, or schemas to validate
    if (middleware.length > 0 || routeDef.handler || routeDef.query || routeDef.body) {
      return runMiddleware(middleware, context, async () => {
        // Validate query params inside the handler.
        let query = {};
        if (querySchema) {
          const raw = Object.fromEntries(new URL(c.req.url).searchParams);
          const result = querySchema.safeParse(raw);
          if (!result.success) {
            return Response.json({ error: 'Invalid query parameters', details: result.error.flatten() }, { status: 400 });
          }
          query = result.data;
        }

        // Validate body.
        let body = {};
        if (bodySchema && ['post', 'put', 'patch'].includes(routeDef.method)) {
          const raw = await c.req.json().catch(() => ({}));
          const result = bodySchema.safeParse(raw);
          if (!result.success) {
            return Response.json({ error: 'Invalid request body', details: result.error.flatten() }, { status: 400 });
          }
          body = result.data;
        }

        // Update context params with validated values.
        context.params = { query, body };

        if (routeDef.handler) {
          return routeDef.handler(c.req.raw, { query, body }, c.env, executionCtx);
        }
        // No handler defined.
        return Response.json({});
      });
    }

    // No handler defined and no middleware.
    return Response.json({});
  };
}

/** Mounts a router onto a Hono app. */
export function mount<T extends RouterRoutes>(
  app: Hono,
  routerDef: Router<T>,
  parentPath = '',
  parentMiddleware: Middleware[] = []
): void {
  // Normalize path joining to avoid double slashes
  const joinPaths = (p1: string, p2: string) => {
    if (!p1) return p2;
    if (!p2) return p1;
    const separator = p1.endsWith('/') || p2.startsWith('/') ? '' : '/';
    return `${p1}${separator}${p2}`.replace(/\/+/g, '/');
  };

  const fullBasePath = joinPaths(parentPath, routerDef.basePath);
  // Accumulate middleware from parent and current router
  const currentMiddleware = [...parentMiddleware, ...(routerDef.middleware || [])];

  for (const [, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      mount(app, entry, fullBasePath, currentMiddleware);
    } else if (isRoute(entry)) {
      const fullPath = joinPaths(fullBasePath, entry.path);
      const handler = createHonoHandler(entry, currentMiddleware);

      switch (entry.method) {
        case 'get':
          app.get(fullPath, handler);
          break;
        case 'post':
          app.post(fullPath, handler);
          break;
        case 'put':
          app.put(fullPath, handler);
          break;
        case 'patch':
          app.patch(fullPath, handler);
          break;
        case 'delete':
          app.delete(fullPath, handler);
          break;
        case 'options':
          app.options(fullPath, handler);
          break;
        // HEAD is automatically handled by GET in Hono.
      }
    }
  }
}

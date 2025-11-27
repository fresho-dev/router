/**
 * @fileoverview Standalone router using standard Web APIs.
 *
 * Provides a native fetch handler for routing without framework dependencies.
 */

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

/** Compiled route with pattern matcher and handler. */
interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  route: RouteDefinition;
  middleware: Middleware[];
}

/** Converts a route path to a regex pattern. */
function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Replace :param with named capture groups.
  const regexStr = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/** Collects and compiles all routes from a router tree. */
function compileRoutes(
  routerDef: Router<RouterRoutes>,
  parentPath = '',
  parentMiddleware: Middleware[] = []
): CompiledRoute[] {
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
  const compiled: CompiledRoute[] = [];

  for (const [, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      compiled.push(...compileRoutes(entry, fullBasePath, currentMiddleware));
    } else if (isRoute(entry)) {
      const fullPath = joinPaths(fullBasePath, entry.path);
      const { pattern, paramNames } = pathToRegex(fullPath);

      compiled.push({
        method: entry.method.toUpperCase(),
        pattern,
        paramNames,
        route: entry,
        middleware: currentMiddleware,
      });
    }
  }

  return compiled;
}

/** Handler function signature for the standalone router. */
export type FetchHandler = (
  request: Request,
  env?: unknown,
  ctx?: ExecutionContext
) => Response | Promise<Response>;

/** Creates a fetch handler from a router definition. */
export function createHandler<T extends RouterRoutes>(
  routerDef: Router<T>
): FetchHandler {
  const compiledRoutes = compileRoutes(routerDef);

  return async (
    request: Request,
    env?: unknown,
    ctx?: ExecutionContext
  ): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Find matching route.
    for (const compiled of compiledRoutes) {
      // For OPTIONS requests, match by path only to allow CORS preflight handling
      if (method !== 'OPTIONS' && compiled.method !== method) continue;

      const match = compiled.pattern.exec(url.pathname);
      if (!match) continue;

      const routeDef = compiled.route;

      // Create middleware context with empty params initially.
      const context: MiddlewareContext = {
        request,
        params: { query: {}, body: {} },
        env,
        ctx,
      };

      // Run middleware chain with validation and handler as final step.
      // Always run if there's middleware, handler, or schemas to validate
      if (compiled.middleware.length > 0 || routeDef.handler || routeDef.query || routeDef.body) {
        return runMiddleware(compiled.middleware, context, async () => {
          // Validate query params inside the handler.
          let query = {};
          if (routeDef.query) {
            const querySchema = compileSchema(routeDef.query);
            const raw = Object.fromEntries(url.searchParams);
            const result = querySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                { error: 'Invalid query parameters', details: result.error.flatten() },
                { status: 400 }
              );
            }
            query = result.data;
          }

          // Validate body.
          let body = {};
          if (routeDef.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
            const bodySchema = compileSchema(routeDef.body);
            const raw = await request.json().catch(() => ({}));
            const result = bodySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                { error: 'Invalid request body', details: result.error.flatten() },
                { status: 400 }
              );
            }
            body = result.data;
          }

          // Update context params with validated values.
          context.params = { query, body };

          if (routeDef.handler) {
            return routeDef.handler(request, { query, body }, env, ctx);
          }
          // No handler defined.
          return Response.json({});
        });
      }

      // No handler defined and no middleware.
      return Response.json({});
    }

    // No matching route found.
    return Response.json({ error: 'Not Found' }, { status: 404 });
  };
}

/**
 * @fileoverview HTTP request handler for @fresho/router.
 *
 * Builds paths from property names:
 * - Regular properties = path segments
 * - `$param` properties = dynamic segments (`:param`)
 * - `get`, `post`, etc. = method handlers
 */

import type { Middleware, MiddlewareContext } from './middleware.js';
import { runMiddleware } from './middleware.js';
import type { CompiledSchema } from './schema.js';
import { compileSchema } from './schema.js';
import type {
  ExecutionContext,
  FetchHandler,
  RouteDefinition,
  Router,
  RouterRoutes,
} from './types.js';
import { HTTP_METHODS, isFunction, isRoute, isRouter } from './types.js';

/** Compiled route with pattern matcher and handler. */
interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (context: any) => unknown;
  middleware: Middleware[];
  querySchema?: CompiledSchema<unknown>;
  bodySchema?: CompiledSchema<unknown>;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a path with :param segments to a regex pattern.
 */
function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const parts = path.split(/:(\w+)/g);
  let regexStr = '';

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      regexStr += escapeRegex(parts[i]);
    } else {
      paramNames.push(parts[i]);
      regexStr += '([^/]+)';
    }
  }

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/**
 * Converts a property name to a path segment.
 * - `$param` becomes `:param`
 * - Other names become literal segments
 */
function propertyToSegment(prop: string): string {
  if (prop.startsWith('$')) {
    return `:${prop.slice(1)}`;
  }
  return prop;
}

/** Collects and compiles all routes from a router tree. */
function compileRoutes(
  routerDef: Router<RouterRoutes>,
  parentPath = '',
  parentMiddleware: Middleware[] = [],
): CompiledRoute[] {
  const currentMiddleware = [...parentMiddleware, ...(routerDef.middleware || [])];
  const compiled: CompiledRoute[] = [];

  for (const [prop, entry] of Object.entries(routerDef.routes)) {
    // Check if entry is a nested router first (takes precedence over method name check).
    // This allows path segments named 'get', 'post', etc. when they contain routers.
    if (isRouter(entry)) {
      // Nested router - recurse with updated path.
      const segment = propertyToSegment(prop);
      const newPath = parentPath ? `${parentPath}/${segment}` : `/${segment}`;
      compiled.push(...compileRoutes(entry, newPath, currentMiddleware));
    } else if (HTTP_METHODS.has(prop)) {
      // Method handler (get, post, etc.) - only when entry is a route or function.
      const method = prop.toUpperCase();
      const path = parentPath || '/';
      const { pattern, paramNames } = pathToRegex(path);

      if (isFunction(entry)) {
        // Bare function handler.
        compiled.push({
          method,
          pattern,
          paramNames,
          handler: entry,
          middleware: currentMiddleware,
        });
      } else if (isRoute(entry)) {
        // Route with schemas.
        const routeDef = entry as RouteDefinition;
        compiled.push({
          method,
          pattern,
          paramNames,
          handler: routeDef.handler,
          middleware: currentMiddleware,
          querySchema: routeDef.query ? compileSchema(routeDef.query) : undefined,
          bodySchema: routeDef.body ? compileSchema(routeDef.body) : undefined,
        });
      }
    }
  }

  return compiled;
}

/**
 * Strips the body from a response for HEAD requests.
 */
function stripBodyForHead(response: Response, isHead: boolean): Response {
  if (!isHead) return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Creates a fetch handler from a router definition.
 *
 * @example
 * ```typescript
 * const api = router({
 *   health: router({
 *     get: async () => ({ status: 'ok' }),
 *   }),
 *   users: router({
 *     get: async () => [...],
 *     $id: router({
 *       get: async (c) => ({ id: c.path.id }),
 *     }),
 *   }),
 * });
 *
 * export default { fetch: api.handler() };
 * ```
 */
export function createHandler<T extends RouterRoutes>(routerDef: Router<T>): FetchHandler {
  const compiledRoutes = compileRoutes(routerDef);

  return async (request: Request, env?: unknown, ctx?: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const isHead = method === 'HEAD';

    // Find matching route.
    for (const compiled of compiledRoutes) {
      const methodMatches =
        compiled.method === method ||
        method === 'OPTIONS' ||
        (method === 'HEAD' && compiled.method === 'GET');
      if (!methodMatches) continue;

      const match = compiled.pattern.exec(url.pathname);
      if (!match) continue;

      // Extract path parameters.
      const path: Record<string, string> = {};
      for (let i = 0; i < compiled.paramNames.length; i++) {
        path[compiled.paramNames[i]] = decodeURIComponent(match[i + 1]);
      }

      // Create middleware context.
      const context: MiddlewareContext = {
        request,
        path,
        query: {},
        body: {},
        env,
        executionCtx: ctx,
      };

      // Run middleware and handler.
      if (
        compiled.middleware.length > 0 ||
        compiled.handler ||
        compiled.querySchema ||
        compiled.bodySchema
      ) {
        const response = await runMiddleware(compiled.middleware, context, async () => {
          const routeId = `${compiled.method} ${url.pathname}`;

          // Validate query params.
          let query: unknown = {};
          if (compiled.querySchema) {
            const raw = Object.fromEntries(url.searchParams);
            const result = compiled.querySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                {
                  error: 'Invalid query parameters',
                  route: routeId,
                  details: result.error.flatten(),
                },
                { status: 400 },
              );
            }
            query = result.data;
          }

          // Validate body.
          let body: unknown = {};
          if (compiled.bodySchema && ['POST', 'PUT', 'PATCH'].includes(method)) {
            const raw = await request.json().catch(() => ({}));
            const result = compiled.bodySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                { error: 'Invalid request body', route: routeId, details: result.error.flatten() },
                { status: 400 },
              );
            }
            body = result.data;
          }

          context.query = query;
          context.body = body;

          if (compiled.handler) {
            // Build handler context with middleware extensions.
            const handlerContext = {
              request,
              path,
              query,
              body,
              env,
              executionCtx: ctx,
            };

            // Copy middleware extensions.
            for (const key of Object.keys(context)) {
              if (!['request', 'path', 'query', 'body', 'env', 'executionCtx'].includes(key)) {
                (handlerContext as Record<string, unknown>)[key] = (
                  context as Record<string, unknown>
                )[key];
              }
            }

            const result = await compiled.handler(handlerContext);
            if (result instanceof Response) {
              return result;
            }
            return Response.json(result);
          }

          return Response.json({});
        });
        return stripBodyForHead(response, isHead);
      }

      return stripBodyForHead(Response.json({}), isHead);
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  };
}

/**
 * @fileoverview HTTP request handler for typed-routes.
 *
 * Provides a native fetch handler for routing without framework dependencies.
 */

import type { RouteDefinition, Router, RouterRoutes, ExecutionContext, FetchHandler } from './types.js';
import type { CompiledSchema } from './schema.js';
import type { Middleware, MiddlewareContext } from './middleware.js';
import { isRouter, isRoute } from './types.js';
import { compileSchema } from './schema.js';
import { runMiddleware } from './middleware.js';

/** Compiled route with pattern matcher, handler, and pre-compiled schemas. */
interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  route: RouteDefinition;
  middleware: Middleware[];
  /** Pre-compiled query schema (undefined if no query schema). */
  querySchema?: CompiledSchema<unknown>;
  /** Pre-compiled body schema (undefined if no body schema). */
  bodySchema?: CompiledSchema<unknown>;
}

/**
 * Escapes special regex characters in a string.
 *
 * Used to treat literal parts of a path (like `.pdf`) as exact matches,
 * not regex patterns (where `.` would match any character).
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a route path to a regex pattern for URL matching.
 *
 * Handles two types of segments:
 * - **Parameters** (`:name`): Converted to capture groups `([^/]+)` that match
 *   any characters except `/`. Param names must be word characters (`\w+`).
 * - **Literals**: Everything else is escaped and matched exactly. This includes
 *   file extensions (`.pdf`), separators (`-`), and any special regex chars.
 *
 * The type-level equivalent is `ExtractPathParams` in types.ts, which uses the
 * same delimiter logic (`/`, `.`, `-`) to extract parameter names at compile time.
 *
 * @example
 * ```typescript
 * // Simple param
 * pathToRegex('/users/:id')
 * // → { pattern: /^\/users\/([^/]+)$/, paramNames: ['id'] }
 *
 * // Param with extension suffix
 * pathToRegex('/files/:name.pdf')
 * // → { pattern: /^\/files\/([^/]+)\.pdf$/, paramNames: ['name'] }
 * // Note: `.` is escaped to `\.` so it matches literal dot only
 *
 * // Multiple params with delimiters
 * pathToRegex('/audio/:artist-:track.mp3')
 * // → { pattern: /^\/audio\/([^/]+)-([^/]+)\.mp3$/, paramNames: ['artist', 'track'] }
 * ```
 */
function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Split path by `:param` pattern. The regex captures param names in odd indices.
  // Example: '/files/:name.pdf' → ['files/', 'name', '.pdf']
  const parts = path.split(/:(\w+)/g);
  let regexStr = '';

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Even index: literal segment - escape regex special chars.
      regexStr += escapeRegex(parts[i]);
    } else {
      // Odd index: param name - add capture group.
      paramNames.push(parts[i]);
      regexStr += '([^/]+)';
    }
  }

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

      // Pre-compile schemas during route registration (not per-request).
      const querySchema = entry.query ? compileSchema(entry.query) : undefined;
      const bodySchema = entry.body ? compileSchema(entry.body) : undefined;

      compiled.push({
        method: entry.method.toUpperCase(),
        pattern,
        paramNames,
        route: entry,
        middleware: currentMiddleware,
        querySchema,
        bodySchema,
      });
    }
  }

  return compiled;
}

/**
 * Strips the body from a response for HEAD requests.
 *
 * Per RFC 9110, HEAD responses must have the same headers as GET but no body.
 * Note: The GET handler is fully executed to generate headers. To optimize
 * HEAD requests, check `request.method === 'HEAD'` in your handler to skip
 * expensive operations.
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
 * This is called internally by `router().handler()`. You typically don't need
 * to call this directly unless you're building custom integrations.
 *
 * The handler:
 * - Matches incoming requests to routes by method and path
 * - Extracts path parameters from the URL
 * - Runs middleware in order
 * - Validates query params and body against schemas
 * - Calls the route handler and returns the response
 *
 * @param routerDef - The router definition to create a handler for
 * @returns A fetch-compatible handler function
 *
 * @example
 * ```typescript
 * const api = router('/api', { ... });
 *
 * // Using router().handler() (preferred)
 * export default { fetch: api.handler() };
 *
 * // Using createHandler directly (advanced)
 * import { createHandler } from 'typed-routes';
 * const handler = createHandler(api);
 * ```
 */
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
    const isHead = method === 'HEAD';

    // Find matching route.
    for (const compiled of compiledRoutes) {
      // Match routes by method, with special cases:
      // - OPTIONS: match any route for CORS preflight handling
      // - HEAD: match GET routes per RFC 9110 (handler runs, body stripped)
      const methodMatches =
        compiled.method === method ||
        method === 'OPTIONS' ||
        (method === 'HEAD' && compiled.method === 'GET');
      if (!methodMatches) continue;

      const match = compiled.pattern.exec(url.pathname);
      if (!match) continue;

      const routeDef = compiled.route;

      // Extract path parameters from the match.
      const path: Record<string, string> = {};
      for (let i = 0; i < compiled.paramNames.length; i++) {
        path[compiled.paramNames[i]] = match[i + 1];
      }

      // Create middleware context with empty params initially.
      const context: MiddlewareContext = {
        request,
        path,
        query: {},
        body: {},
        env,
        executionCtx: ctx,
      };

      // Run middleware chain with validation and handler as final step.
      // Always run if there's middleware, handler, or schemas to validate.
      if (compiled.middleware.length > 0 || routeDef.handler || compiled.querySchema || compiled.bodySchema) {
        const response = await runMiddleware(compiled.middleware, context, async () => {
          // Validate query params using pre-compiled schema.
          const routeId = `${compiled.method} ${url.pathname}`;
          let query: unknown = {};
          if (compiled.querySchema) {
            const raw = Object.fromEntries(url.searchParams);
            const result = compiled.querySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                { error: 'Invalid query parameters', route: routeId, details: result.error.flatten() },
                { status: 400 }
              );
            }
            query = result.data;
          }

          // Validate body using pre-compiled schema.
          let body: unknown = {};
          if (compiled.bodySchema && ['POST', 'PUT', 'PATCH'].includes(method)) {
            const raw = await request.json().catch(() => ({}));
            const result = compiled.bodySchema.safeParse(raw);
            if (!result.success) {
              return Response.json(
                { error: 'Invalid request body', route: routeId, details: result.error.flatten() },
                { status: 400 }
              );
            }
            body = result.data;
          }

          // Update context with validated values.
          context.query = query;
          context.body = body;

          if (routeDef.handler) {
            // Build unified handler context with middleware extensions.
            const handlerContext = {
              request,
              path,
              query,
              body,
              env,
              executionCtx: ctx,
            } as Parameters<typeof routeDef.handler>[0];

            // Copy middleware extensions to handler context.
            for (const key of Object.keys(context)) {
              if (!['request', 'path', 'query', 'body', 'env', 'executionCtx'].includes(key)) {
                (handlerContext as unknown as Record<string, unknown>)[key] = context[key];
              }
            }

            // Call handler and auto-wrap non-Response returns in Response.json().
            const result = await routeDef.handler(handlerContext);
            if (result instanceof Response) {
              return result;
            }
            return Response.json(result);
          }
          // No handler defined.
          return Response.json({});
        });
        return stripBodyForHead(response, isHead);
      }

      // No handler defined and no middleware.
      return stripBodyForHead(Response.json({}), isHead);
    }

    // No matching route found.
    return Response.json({ error: 'Not Found' }, { status: 404 });
  };
}

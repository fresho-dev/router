/**
 * @fileoverview Local client for @fresho/router.
 *
 * Provides a typed client that invokes route handlers directly without HTTP.
 * Uses the same API as createHttpClient for consistency.
 *
 * @example
 * ```typescript
 * import { createLocalClient } from '@fresho/router';
 * import { api } from './api.js';
 *
 * const client = createLocalClient(api);
 *
 * // Same API as HTTP client
 * await client.health();
 * await client.users();
 * await client.users.post({ body: { name: 'Alice' } });
 * await client.users.$id({ path: { id: '123' } });
 * ```
 */

import { createRecursiveProxy } from './client-proxy.js';
import type { RequestOptions, RouterClient } from './client-types.js';
import { compileSchema } from './schema.js';
import type { ExecutionContext, RouteDefinition, Router, RouterRoutes } from './types.js';
import { isFunction, isRoute, isRouter } from './types.js';

// =============================================================================
// Configuration Types
// =============================================================================

/** Local client configuration. */
export interface LocalClientConfig {
  env?: unknown;
  ctx?: ExecutionContext;
}

/** Options for a local client request. */
export type LocalRequestOptions = RequestOptions<LocalClientConfig>;

// =============================================================================
// Client Type Construction (mirrors http-client types)
// =============================================================================

export type LocalClient<T extends Router<RouterRoutes>> = {
  configure(config: LocalClientConfig): void;
} & RouterClient<T['routes'], LocalClientConfig>;

// =============================================================================
// Implementation
// =============================================================================

interface SharedConfig {
  current: LocalClientConfig;
}

interface RouteInfo {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (context: any) => unknown;
  querySchema?: ReturnType<typeof compileSchema>;
  bodySchema?: ReturnType<typeof compileSchema>;
}

/**
 * Finds a method handler in a router tree.
 */
function findHandler(
  routerDef: Router<RouterRoutes>,
  segments: string[],
  method: string,
): RouteInfo | null {
  let current: Router<RouterRoutes> | undefined = routerDef;

  // Navigate through path segments.
  for (const segment of segments) {
    if (!current) return null;

    const entry: unknown = current.routes[segment];
    if (isRouter(entry)) {
      current = entry;
    } else {
      return null;
    }
  }

  if (!current) return null;

  // Find the method handler.
  const entry = current.routes[method];
  if (!entry) return null;

  if (isFunction(entry)) {
    return { handler: entry };
  }

  if (isRoute(entry)) {
    const routeDef = entry as RouteDefinition;
    return {
      handler: routeDef.handler,
      querySchema: routeDef.query ? compileSchema(routeDef.query) : undefined,
      bodySchema: routeDef.body ? compileSchema(routeDef.body) : undefined,
    };
  }

  return null;
}

/**
 * Collects path parameters from segments.
 */
function collectPathParams(
  segments: string[],
  pathValues?: Record<string, string>,
): Record<string, string> {
  const params: Record<string, string> = {};

  for (const segment of segments) {
    if (segment.startsWith('$')) {
      const paramName = segment.slice(1);
      const value = pathValues?.[paramName];
      if (!value) {
        throw new Error(`Missing path parameter: ${paramName}`);
      }
      params[paramName] = value;
    }
  }

  return params;
}

/**
 * Creates a typed local client from a router definition.
 *
 * @example
 * ```typescript
 * import { createLocalClient } from '@fresho/router';
 * import { api } from './api.js';
 *
 * const client = createLocalClient(api);
 * client.configure({ env: { DB: mockDatabase } });
 *
 * await client.health();
 * await client.users();
 * await client.users.post({ body: { name: 'Alice' } });
 * await client.users.$id({ path: { id: '123' } });
 * ```
 */
export function createLocalClient<T extends Router<RouterRoutes>>(routerDef: T): LocalClient<T> {
  const sharedConfig: SharedConfig = { current: {} };

  const client = {
    configure(config: LocalClientConfig) {
      Object.assign(sharedConfig.current, config);
    },
  } as LocalClient<T>;

  const proxy = createRecursiveProxy({
    onRequest: (segments, method, options) => {
      return invokeHandler(
        sharedConfig,
        routerDef,
        segments,
        method,
        options as LocalRequestOptions | undefined,
      );
    },
  });

  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'configure') return target.configure;
      // Delegate to recursive proxy for path building
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (proxy as any)[prop];
    },
    apply(_target, _thisArg, args) {
      return invokeHandler(
        sharedConfig,
        routerDef,
        [],
        'get',
        args[0] as LocalRequestOptions | undefined,
      );
    },
  }) as LocalClient<T>;
}

/** Invokes a handler directly. */
async function invokeHandler(
  sharedConfig: SharedConfig,
  routerDef: Router<RouterRoutes>,
  segments: string[],
  method: string,
  options?: LocalRequestOptions,
): Promise<unknown> {
  const config = sharedConfig.current;
  const routeInfo = findHandler(routerDef, segments, method);

  if (!routeInfo) {
    throw new Error(`No handler found for ${method.toUpperCase()} /${segments.join('/')}`);
  }

  // Collect path params.
  const pathParams = collectPathParams(segments, options?.path);

  // Validate query.
  let query: unknown = {};
  if (routeInfo.querySchema) {
    const result = routeInfo.querySchema.safeParse(options?.query ?? {});
    if (!result.success) {
      throw new Error(`Invalid query parameters: ${JSON.stringify(result.error.flatten())}`);
    }
    query = result.data;
  }

  // Validate body.
  let body: unknown = {};
  if (routeInfo.bodySchema) {
    const result = routeInfo.bodySchema.safeParse((options?.body ?? {}) as object);
    if (!result.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(result.error.flatten())}`);
    }
    body = result.data;
  }

  // Build path for synthetic request URL.
  const pathParts = segments.map((s) =>
    s.startsWith('$') ? encodeURIComponent(pathParams[s.slice(1)] || '') : s,
  );
  const urlPath = `/${pathParts.join('/')}`;
  const url = new URL(urlPath, 'http://localhost');
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  // Build request.
  const requestInit: RequestInit = {
    method: method.toUpperCase(),
  };
  if (options?.body && ['post', 'put', 'patch'].includes(method)) {
    requestInit.headers = { 'Content-Type': 'application/json' };
    requestInit.body = JSON.stringify(options.body);
  }

  const request = new Request(url.toString(), requestInit);

  // Build context.
  const context = {
    request,
    path: pathParams,
    query,
    body,
    env: options?.env ?? config.env,
    executionCtx: options?.ctx ?? config.ctx,
  };

  // Call handler.
  const result = await routeInfo.handler(context);

  // Parse response if needed.
  if (result instanceof Response) {
    return result.json();
  }

  return result;
}

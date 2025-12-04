/**
 * @fileoverview Local client for typed-routes.
 *
 * Provides a typed client that invokes route handlers directly without HTTP.
 * Uses the same API as createHttpClient for consistency.
 *
 * @example
 * ```typescript
 * import { createLocalClient } from 'typed-routes';
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

import type { InferSchema } from './schema.js';
import { compileSchema } from './schema.js';
import type {
  ExecutionContext,
  Method,
  RouteDefinition,
  Router,
  RouterBrand,
  RouterRoutes,
} from './types.js';
import { HTTP_METHODS, isFunction, isRoute, isRouter } from './types.js';

// =============================================================================
// Configuration Types
// =============================================================================

/** Local client configuration. */
export interface LocalClientConfig {
  env?: unknown;
  ctx?: ExecutionContext;
}

/** Options for a local client request. */
export interface LocalRequestOptions {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  env?: unknown;
  ctx?: ExecutionContext;
}

// =============================================================================
// Client Type Construction (mirrors http-client types)
// =============================================================================

type HttpMethods = 'get' | 'post' | 'put' | 'patch' | 'delete';

type ExtractReturn<T> = T extends (...args: unknown[]) => infer R
  ? R extends Promise<infer U>
    ? U
    : R
  : unknown;

type BuildOptions<HasPathParams extends boolean, Q, B> = HasPathParams extends true
  ? { path: Record<string, string> } & (keyof Q extends never ? {} : { query?: Q }) &
      (keyof B extends never ? {} : { body: B }) &
      LocalClientConfig
  : (keyof Q extends never ? {} : { query?: Q }) &
      (keyof B extends never ? {} : { body: B }) &
      LocalClientConfig;

type MethodClient<T, HasPathParams extends boolean = false> = T extends RouteDefinition<
  infer Q,
  infer B,
  infer R
>
  ? (options?: BuildOptions<HasPathParams, InferSchema<Q>, InferSchema<B>>) => Promise<R>
  : T extends (...args: unknown[]) => unknown
    ? (options?: BuildOptions<HasPathParams, {}, {}>) => Promise<ExtractReturn<T>>
    : never;

type HasParams<Path extends string[]> = Path extends [infer Head, ...infer Rest extends string[]]
  ? Head extends `$${string}`
    ? true
    : HasParams<Rest>
  : false;

type RouterClient<T extends RouterRoutes, Path extends string[] = []> = {
  [K in keyof T as K extends HttpMethods ? K : never]: T[K] extends
    | RouteDefinition
    | ((...args: unknown[]) => unknown)
    ? MethodClient<T[K], HasParams<Path>>
    : never;
} & {
  // Uses RouterBrand check first to handle cross-module type inference.
  [K in keyof T as K extends HttpMethods ? never : K]: T[K] extends RouterBrand
    ? T[K] extends Router<infer Routes>
      ? RouterClient<Routes, [...Path, K & string]> &
          ((options?: LocalRequestOptions) => Promise<unknown>)
      : never
    : never;
} & ((options?: LocalRequestOptions) => Promise<unknown>);

export type LocalClient<T extends Router<RouterRoutes>> = {
  configure(config: LocalClientConfig): void;
} & RouterClient<T['routes']>;

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
 * import { createLocalClient } from 'typed-routes';
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

  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'configure') return target.configure;
      if (typeof prop === 'string') {
        return createPathProxy(sharedConfig, routerDef, [prop]);
      }
      return undefined;
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

/** Creates a proxy that tracks path segments. */
function createPathProxy(
  sharedConfig: SharedConfig,
  routerDef: Router<RouterRoutes>,
  segments: string[],
): unknown {
  const callable = (options?: LocalRequestOptions) => {
    return invokeHandler(sharedConfig, routerDef, segments, 'get', options);
  };

  return new Proxy(callable, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;

      if (HTTP_METHODS.has(prop)) {
        return (options?: LocalRequestOptions) => {
          return invokeHandler(sharedConfig, routerDef, segments, prop as Method, options);
        };
      }

      return createPathProxy(sharedConfig, routerDef, [...segments, prop]);
    },
    apply(_target, _thisArg, args) {
      return callable(args[0] as LocalRequestOptions | undefined);
    },
  });
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

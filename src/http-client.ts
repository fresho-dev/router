/**
 * @fileoverview HTTP client for typed-routes.
 *
 * Provides a fully typed HTTP client that mirrors the router structure.
 * Each route becomes a method with typed parameters and return values.
 *
 * Features:
 * - Full type inference from router definitions
 * - Path parameter substitution with URL encoding
 * - Query parameter serialization
 * - JSON body serialization
 * - Dynamic headers (sync or async functions)
 * - Credentials support for cookie-based auth
 *
 * @example
 * ```typescript
 * import { createHttpClient } from 'typed-routes';
 * import { api } from './api.js';
 *
 * const client = createHttpClient(api);
 * client.configure({ baseUrl: 'https://api.example.com' });
 *
 * // Typed method calls with full inference
 * const user = await client.users.get({ path: { id: '123' } });
 * const created = await client.users.create({ body: { name: 'Alice' } });
 * ```
 */

import type {
  Router,
  RouterRoutes,
  RouteDefinition,
  HttpClientConfig,
  HttpFetchOptions,
  HttpRouterClient,
} from './types.js';
import { isRouter, isRoute } from './types.js';

/**
 * Creates a typed HTTP client from a router definition.
 *
 * The client mirrors the router's structure, with each route becoming a typed
 * method. Nested routers become nested objects on the client.
 *
 * @param routerDef - The router definition to create a client for
 * @returns A typed client with a `configure` method and route methods
 *
 * @example
 * ```typescript
 * const api = router('/api', {
 *   users: router('/users', {
 *     list: route({ method: 'get', path: '', handler: ... }),
 *     get: route({ method: 'get', path: '/:id', handler: ... }),
 *     create: route({ method: 'post', path: '', body: { name: 'string' }, handler: ... }),
 *   }),
 * });
 *
 * const client = createHttpClient(api);
 *
 * // Configure base URL and authentication
 * client.configure({
 *   baseUrl: 'https://api.example.com',
 *   headers: {
 *     'Authorization': () => `Bearer ${getToken()}`,  // Dynamic header
 *   },
 *   credentials: 'include',  // For cookie-based auth
 * });
 *
 * // Call routes with typed parameters
 * const users = await client.users.list();
 * const user = await client.users.get({ path: { id: '123' } });
 * const created = await client.users.create({ body: { name: 'Alice' } });
 * ```
 */
export function createHttpClient<T extends RouterRoutes>(
  routerDef: Router<T>
): HttpRouterClient<T> {
  return buildClient(routerDef, '', { current: {} });
}

/** Internal: builds client recursively with shared config. */
function buildClient<T extends RouterRoutes>(
  routerDef: Router<T>,
  parentPath: string,
  sharedConfig: { current: HttpClientConfig }
): HttpRouterClient<T> {
  const fullBasePath = parentPath + routerDef.basePath;

  const client = {
    configure(config: HttpClientConfig) {
      Object.assign(sharedConfig.current, config);
    },
  } as HttpRouterClient<T>;

  populateRoutes(client, routerDef, fullBasePath, sharedConfig);

  return client;
}

/** Populates route methods on a client object. */
function populateRoutes<T extends RouterRoutes>(
  target: Record<string, unknown>,
  routerDef: Router<T>,
  basePath: string,
  sharedConfig: { current: HttpClientConfig }
): void {
  for (const [key, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      const nested = {} as Record<string, unknown>;
      populateRoutes(nested, entry, basePath + entry.basePath, sharedConfig);
      target[key] = nested;
    } else if (isRoute(entry)) {
      target[key] = createHttpRouteFetcher(entry, basePath, sharedConfig);
    }
  }
}

/** Substitutes path parameters in a route path. */
function substitutePath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, name) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter: ${name}`);
    }
    return encodeURIComponent(value);
  });
}

/** Creates an HTTP fetch function for a route. */
function createHttpRouteFetcher(
  routeDef: RouteDefinition,
  basePath: string,
  sharedConfig: { current: HttpClientConfig }
): (options?: HttpFetchOptions) => Promise<unknown> {
  return async (options: HttpFetchOptions = {}) => {
    const config = sharedConfig.current;

    // Substitute path parameters before building URL.
    const pathParams = (options.path ?? {}) as Record<string, string>;
    const fullPath = substitutePath(basePath + routeDef.path, pathParams);

    // Build URL (relative if no baseUrl configured).
    const baseUrl =
      config.baseUrl || (typeof window !== 'undefined' ? window.location?.origin : undefined);
    const url = baseUrl ? new URL(fullPath, baseUrl) : new URL(fullPath, 'http://localhost');

    // Add query params.
    if (options.query && typeof options.query === 'object') {
      for (const [key, value] of Object.entries(options.query as Record<string, unknown>)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    // Build headers (config headers, then request headers override).
    // Config headers can be dynamic (sync or async functions), per-request headers are static.
    const headers = new Headers();
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        const resolved = typeof value === 'function' ? await value() : value;
        if (resolved != null) {
          headers.set(key, resolved);
        }
      }
    }
    if (options.headers) {
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    }

    // Build request.
    const init: RequestInit = {
      method: routeDef.method.toUpperCase(),
      headers,
      credentials: config.credentials,
    };

    if (options.body && ['post', 'put', 'patch'].includes(routeDef.method)) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }

    // Use pathname + search for relative URLs when no baseUrl.
    const fetchUrl = config.baseUrl ? url.toString() : url.pathname + url.search;

    const response = await fetch(fetchUrl, init);

    if (!response.ok) {
      throw new Error((await response.text()) || response.statusText);
    }

    return response.json();
  };
}

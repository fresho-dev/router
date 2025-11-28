/**
 * @fileoverview HTTP client implementation.
 *
 * Provides typed HTTP fetch client for routers.
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

/** Creates an HTTP client from a router. */
export function createHttpRouterClient<T extends RouterRoutes>(
  routerDef: Router<T>,
  parentPath = '',
  sharedConfig: { current: HttpClientConfig } = { current: {} }
): HttpRouterClient<T> {
  const fullBasePath = parentPath + routerDef.basePath;

  const client = {
    configure(config: HttpClientConfig) {
      Object.assign(sharedConfig.current, config);
    },
  } as HttpRouterClient<T>;

  populateHttpClientRoutes(client, routerDef, fullBasePath, sharedConfig);

  return client;
}

/** Populates route methods on a client object. */
function populateHttpClientRoutes<T extends RouterRoutes>(
  target: Record<string, unknown>,
  routerDef: Router<T>,
  basePath: string,
  sharedConfig: { current: HttpClientConfig }
): void {
  for (const [key, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      const nested = {} as Record<string, unknown>;
      populateHttpClientRoutes(nested, entry, basePath + entry.basePath, sharedConfig);
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
): (options?: HttpFetchOptions<unknown, unknown, unknown>) => Promise<unknown> {
  return async (options: HttpFetchOptions<unknown, unknown, unknown> = {}) => {
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
    const headers = new Headers(config.headers);
    if (options.headers) {
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    }

    // Build request.
    const init: RequestInit = {
      method: routeDef.method.toUpperCase(),
      headers,
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

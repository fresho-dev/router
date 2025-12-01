/**
 * @fileoverview HTTP client for typed-routes.
 *
 * Provides a typed HTTP client using type-only imports.
 * URLs are built from property access chains:
 * - Property names = path segments
 * - `$param` = dynamic segment (substituted from path options)
 * - `get()`, `post()`, etc. = HTTP methods
 * - Direct call = implicit GET
 *
 * @example
 * ```typescript
 * // Type-only import - no server code in bundle!
 * import type { api } from './server/api.js';
 * import { createHttpClient } from 'typed-routes';
 *
 * const client = createHttpClient<typeof api>({
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * // URLs from property chains:
 * await client.health();                           // GET /health
 * await client.users();                            // GET /users
 * await client.users.post({ body: {...} });        // POST /users
 * await client.users.$id({ path: { id: '123' } }); // GET /users/123
 * ```
 */

import type { Router, RouterRoutes, RouteDefinition, Method, RouterBrand } from './types.js';
import type { SchemaDefinition, InferSchema } from './schema.js';

// =============================================================================
// Configuration Types
// =============================================================================

/** Header value that can be static or dynamic. */
export type HeaderValue =
  | string
  | (() => string | null | undefined | Promise<string | null | undefined>);

/** HTTP client configuration. */
export interface HttpClientConfig {
  baseUrl?: string;
  headers?: Record<string, HeaderValue>;
  credentials?: RequestCredentials;
}

/** Options for an HTTP request. */
export interface HttpRequestOptions {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: HeadersInit;
}

// =============================================================================
// Client Type Construction
// =============================================================================

/** HTTP methods available on route clients. */
type HttpMethods = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Extract return type from a handler. */
type ExtractReturn<T> = T extends (...args: unknown[]) => infer R
  ? R extends Promise<infer U> ? U : R
  : unknown;

/** Build options type based on whether path params are needed. */
type BuildOptions<HasPathParams extends boolean, Q, B> =
  HasPathParams extends true
    ? { path: Record<string, string> } & (keyof Q extends never ? {} : { query?: Q }) & (keyof B extends never ? {} : { body: B }) & { headers?: HeadersInit }
    : (keyof Q extends never ? {} : { query?: Q }) & (keyof B extends never ? {} : { body: B }) & { headers?: HeadersInit };

/** Client type for a method entry (route or bare function). */
type MethodClient<T, HasPathParams extends boolean = false> =
  T extends RouteDefinition<infer Q, infer B, infer R>
    ? (options?: BuildOptions<HasPathParams, InferSchema<Q>, InferSchema<B>>) => Promise<R>
    : T extends (...args: unknown[]) => unknown
      ? (options?: BuildOptions<HasPathParams, {}, {}>) => Promise<ExtractReturn<T>>
      : never;

/** Check if router tree contains any $param properties. */
type HasParams<Path extends string[]> =
  Path extends [infer Head, ...infer Rest extends string[]]
    ? Head extends `$${string}` ? true : HasParams<Rest>
    : false;

/** Client type for a router. */
type RouterClient<T extends RouterRoutes, Path extends string[] = []> = {
  // Method handlers become callable methods.
  [K in keyof T as K extends HttpMethods ? K : never]:
    T[K] extends RouteDefinition | ((...args: unknown[]) => unknown)
      ? MethodClient<T[K], HasParams<Path>>
      : never;
} & {
  // Nested routers become nested clients.
  // Uses RouterBrand check first to handle cross-module type inference.
  [K in keyof T as K extends HttpMethods ? never : K]:
    T[K] extends RouterBrand
      ? T[K] extends Router<infer Routes>
        ? RouterClient<Routes, [...Path, K & string]> & ((options?: HttpRequestOptions) => Promise<unknown>)
        : never
      : never;
} & {
  // Direct call = implicit GET.
  (options?: HttpRequestOptions): Promise<unknown>;
};

/** Top-level HTTP client type. */
export type HttpClient<T extends Router<RouterRoutes>> = {
  configure(config: HttpClientConfig): void;
} & RouterClient<T['routes']>;

// =============================================================================
// Implementation
// =============================================================================

interface SharedConfig {
  current: HttpClientConfig;
}

const BODY_METHODS = new Set(['post', 'put', 'patch']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

/**
 * Creates a typed HTTP client.
 *
 * @example
 * ```typescript
 * import type { api } from './server';
 * import { createHttpClient } from 'typed-routes';
 *
 * const client = createHttpClient<typeof api>({
 *   baseUrl: 'https://api.example.com',
 *   headers: { Authorization: () => `Bearer ${getToken()}` },
 * });
 *
 * // GET /health
 * await client.health();
 *
 * // GET /users
 * await client.users();
 *
 * // POST /users
 * await client.users.post({ body: { name: 'Alice' } });
 *
 * // GET /users/123
 * await client.users.$id({ path: { id: '123' } });
 * ```
 */
export function createHttpClient<T extends Router<RouterRoutes>>(
  config: HttpClientConfig = {}
): HttpClient<T> {
  const sharedConfig: SharedConfig = { current: { ...config } };

  const client = {
    configure(newConfig: HttpClientConfig) {
      Object.assign(sharedConfig.current, newConfig);
    },
  } as HttpClient<T>;

  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'configure') return target.configure;
      if (typeof prop === 'string') {
        return createPathProxy(sharedConfig, [prop]);
      }
      return undefined;
    },
    apply(_target, _thisArg, args) {
      // Direct call on root = GET /
      return executeRequest(sharedConfig, [], 'get', args[0] as HttpRequestOptions | undefined);
    },
  }) as HttpClient<T>;
}

/** Creates a proxy that tracks path segments. */
function createPathProxy(sharedConfig: SharedConfig, segments: string[]): unknown {
  const callable = (options?: HttpRequestOptions) => {
    return executeRequest(sharedConfig, segments, 'get', options);
  };

  return new Proxy(callable, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;

      // HTTP method = execute request.
      if (HTTP_METHODS.has(prop)) {
        return (options?: HttpRequestOptions) => {
          return executeRequest(sharedConfig, segments, prop as Method, options);
        };
      }

      // Otherwise = nested path segment.
      return createPathProxy(sharedConfig, [...segments, prop]);
    },
    apply(_target, _thisArg, args) {
      return callable(args[0] as HttpRequestOptions | undefined);
    },
  });
}

/** Builds a URL path from segments, substituting $param with values. */
function buildPath(segments: string[], pathParams?: Record<string, string>): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith('$')) {
      const paramName = segment.slice(1);
      const value = pathParams?.[paramName];
      if (!value) {
        throw new Error(`Missing path parameter: ${paramName}`);
      }
      parts.push(encodeURIComponent(value));
    } else {
      parts.push(segment);
    }
  }

  return '/' + parts.join('/');
}

/** Executes an HTTP request. */
async function executeRequest(
  sharedConfig: SharedConfig,
  segments: string[],
  method: Method,
  options?: HttpRequestOptions
): Promise<unknown> {
  const config = sharedConfig.current;
  const path = buildPath(segments, options?.path);

  // Build URL.
  const baseUrl = config.baseUrl || (typeof window !== 'undefined' ? window.location?.origin : '');
  const url = new URL(path, baseUrl || 'http://localhost');

  // Add query params.
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  // Build headers.
  const headers = new Headers();
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      const resolved = typeof value === 'function' ? await value() : value;
      if (resolved != null) {
        headers.set(key, resolved);
      }
    }
  }
  if (options?.headers) {
    new Headers(options.headers).forEach((v, k) => headers.set(k, v));
  }

  // Build request.
  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
    credentials: config.credentials,
  };

  // Add body.
  if (options?.body && BODY_METHODS.has(method)) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  // Execute.
  const fetchUrl = config.baseUrl ? url.toString() : url.pathname + url.search;
  const response = await fetch(fetchUrl, init);

  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }

  return response.json();
}

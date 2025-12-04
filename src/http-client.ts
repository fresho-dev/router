/**
 * @fileoverview HTTP client for @fresho/router.
 *
 * Provides a typed HTTP client using type-only imports.
 * URLs are built from property access chains:
 * - Property names = path segments (including `get`, `post`, etc.)
 * - `$param` = dynamic segment (substituted from path options)
 * - `$get()`, `$post()`, etc. = HTTP method execution
 * - Direct call `()` = implicit GET
 *
 * The `$` prefix distinguishes HTTP method execution from path navigation,
 * allowing routes with path segments named after HTTP methods (e.g., `/api/get`).
 *
 * @example
 * ```typescript
 * // Type-only import - no server code in bundle!
 * import type { api } from './server/api.js';
 * import { createHttpClient } from '@fresho/router';
 *
 * const client = createHttpClient<typeof api>({
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * // URLs from property chains:
 * await client.health();                            // GET /health (implicit)
 * await client.users.$get();                        // GET /users (explicit)
 * await client.users.$post({ body: {...} });        // POST /users
 * await client.users.$id({ path: { id: '123' } });  // GET /users/123
 *
 * // Navigate to path segments named after HTTP methods:
 * await client.api.get.$get();                      // GET /api/get
 * await client.resources.delete.$get();             // GET /resources/delete
 * ```
 */

import type { InferSchema } from './schema.js';
import type { Method, RouteDefinition, Router, RouterRoutes } from './types.js';

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

/** HTTP method names as defined in routes (lowercase). */
type LowercaseMethods = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Map lowercase method to $-prefixed version. */
type PrefixedMethod<T extends LowercaseMethods> = T extends 'get'
  ? '$get'
  : T extends 'post'
    ? '$post'
    : T extends 'put'
      ? '$put'
      : T extends 'patch'
        ? '$patch'
        : T extends 'delete'
          ? '$delete'
          : never;

/** Extract return type from a handler. */
type ExtractReturn<T> = T extends (...args: unknown[]) => infer R
  ? R extends Promise<infer U>
    ? U
    : R
  : unknown;

/** Detects if a type is `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Checks if a schema type should require a property. */
type RequiresProperty<T> = IsAny<T> extends true ? false : keyof T extends never ? false : true;

/** Build options type based on whether path params are needed. */
type BuildOptions<HasPathParams extends boolean, Q, B> = HasPathParams extends true
  ? { path: Record<string, string> } & (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) & { headers?: HeadersInit }
  : (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) & { headers?: HeadersInit };

/** Safely infer schema, returning {} for any or non-schema types. */
type SafeInferSchema<T> =
  IsAny<T> extends true
    ? {}
    : T extends import('./schema.js').SchemaDefinition
      ? InferSchema<T>
      : {};

/** Client type for a method entry (route or bare function). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MethodClient<T, HasPathParams extends boolean = false> = T extends RouteDefinition<
  infer Q,
  infer B,
  infer R,
  any,
  any
>
  ? (options?: BuildOptions<HasPathParams, SafeInferSchema<Q>, SafeInferSchema<B>>) => Promise<R>
  : T extends (...args: unknown[]) => unknown
    ? (options?: BuildOptions<HasPathParams, {}, {}>) => Promise<ExtractReturn<T>>
    : never;

/** Check if router tree contains any $param properties. */
type HasParams<Path extends string[]> = Path extends [infer Head, ...infer Rest extends string[]]
  ? Head extends `$${string}`
    ? true
    : HasParams<Rest>
  : false;

/** Extract the MethodEntry part from a union type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExtractMethod<T> = Extract<
  T,
  RouteDefinition<any, any, any, any, any> | ((...args: unknown[]) => unknown)
>;

/** Client type for a router. */
type RouterClient<T extends RouterRoutes, Path extends string[] = []> = {
  // Method handlers become $-prefixed callable methods ($get, $post, etc.).
  [K in keyof T as K extends LowercaseMethods ? PrefixedMethod<K> : never]: ExtractMethod<
    T[K]
  > extends infer M
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      M extends RouteDefinition<any, any, any, any, any> | ((...args: unknown[]) => unknown)
      ? MethodClient<M, HasParams<Path>>
      : never
    : never;
} & {
  // ALL keys (including lowercase method names) become navigation paths.
  [K in keyof T]: Extract<T[K], { routes: RouterRoutes }> extends {
    routes: infer Routes extends RouterRoutes;
  }
    ? RouterClient<Routes, [...Path, K & string]> & ImplicitGetCall<Routes, [...Path, K & string]>
    : never;
} & ImplicitGetCall<T, Path>;

/** Helper to extract return type for implicit GET calls. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImplicitGetCall<T extends RouterRoutes, Path extends string[] = []> = 'get' extends keyof T
  ? ExtractMethod<T['get']> extends RouteDefinition<infer _Q, infer _B, infer R, any, any>
    ? HasParams<Path> extends true
      ? (
          options: { path: Record<string, string> } & { query?: Record<string, unknown> } & {
            headers?: HeadersInit;
          },
        ) => Promise<R>
      : (options?: HttpRequestOptions) => Promise<R>
    : ExtractMethod<T['get']> extends (...args: unknown[]) => unknown
      ? HasParams<Path> extends true
        ? (
            options: { path: Record<string, string> } & { query?: Record<string, unknown> } & {
              headers?: HeadersInit;
            },
          ) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
        : (options?: HttpRequestOptions) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
      : (options?: HttpRequestOptions) => Promise<unknown>
  : (options?: HttpRequestOptions) => Promise<unknown>;

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
const HTTP_METHODS = new Set(['$get', '$post', '$put', '$patch', '$delete', '$options', '$head']);

/**
 * Creates a typed HTTP client.
 *
 * HTTP methods are prefixed with `$` to distinguish them from path segments:
 * - `.$get()`, `.$post()`, `.$put()`, `.$patch()`, `.$delete()` - execute HTTP methods
 * - `.propertyName` - navigate to path segment (works for any name including `get`, `post`, etc.)
 * - Direct call `()` - implicit GET request
 *
 * @example
 * ```typescript
 * import type { api } from './server';
 * import { createHttpClient } from '@fresho/router';
 *
 * const client = createHttpClient<typeof api>({
 *   baseUrl: 'https://api.example.com',
 *   headers: { Authorization: () => `Bearer ${getToken()}` },
 * });
 *
 * // GET /health (implicit)
 * await client.health();
 *
 * // GET /users (explicit)
 * await client.users.$get();
 *
 * // POST /users
 * await client.users.$post({ body: { name: 'Alice' } });
 *
 * // GET /users/123
 * await client.users.$id({ path: { id: '123' } });
 *
 * // Navigate through path segments named after HTTP methods:
 * // GET /api/get
 * await client.api.get.$get();
 * ```
 */
export function createHttpClient<T extends Router<RouterRoutes>>(
  config: HttpClientConfig = {},
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

      // $-prefixed method = execute request (strip the $ prefix).
      if (HTTP_METHODS.has(prop)) {
        const method = prop.slice(1) as Method; // Remove $ prefix
        return (options?: HttpRequestOptions) => {
          return executeRequest(sharedConfig, segments, method, options);
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

  return `/${parts.join('/')}`;
}

/** Executes an HTTP request. */
async function executeRequest(
  sharedConfig: SharedConfig,
  segments: string[],
  method: Method,
  options?: HttpRequestOptions,
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

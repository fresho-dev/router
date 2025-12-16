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

import { createRecursiveProxy } from './client-proxy.js';
import type { HeaderValue, RequestOptions, RouterClient } from './client-types.js';
import type { Method, Router, RouterRoutes } from './types.js';

// =============================================================================
// Configuration Types
// =============================================================================

/** HTTP client configuration. */
export interface HttpClientConfig {
  baseUrl?: string;
  headers?: Record<string, HeaderValue>;
  credentials?: RequestCredentials;
  /** Custom fetch implementation for interception or environment-specific behavior. */
  fetch?: typeof fetch;
}

/** Extra options for HTTP requests (headers). */
export interface HttpExtraOptions {
  headers?: HeadersInit;
}

/** Options for an HTTP request. */
export type HttpRequestOptions = RequestOptions<HttpExtraOptions>;

// =============================================================================
// Client Type Construction
// =============================================================================

/** Top-level HTTP client type. */
export type HttpClient<T extends Router<RouterRoutes>> = {
  configure(config: HttpClientConfig): void;
} & RouterClient<T['routes'], HttpExtraOptions>;

// =============================================================================
// Implementation
// =============================================================================

interface SharedConfig {
  current: HttpClientConfig;
}

const BODY_METHODS = new Set(['post', 'put', 'patch']);

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

  const proxy = createRecursiveProxy({
    onRequest: (segments, method, options) => {
      return executeRequest(
        sharedConfig,
        segments,
        method as Method,
        options as HttpRequestOptions,
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
      // Direct call on root = GET /
      return executeRequest(sharedConfig, [], 'get', args[0] as HttpRequestOptions | undefined);
    },
  }) as HttpClient<T>;
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
  const fetchFn = config.fetch || fetch;
  const response = await fetchFn(fetchUrl, init);

  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText);
  }

  return response.json();
}

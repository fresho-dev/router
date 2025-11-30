/**
 * @fileoverview Local client for typed-routes.
 *
 * Provides a typed client that invokes route handlers directly without HTTP.
 * Ideal for testing, server-side rendering, or anywhere you need to call
 * routes programmatically within the same process.
 *
 * Unlike the HTTP client, the local client:
 * - Calls handlers directly (no network overhead)
 * - Validates query/body schemas before calling handlers
 * - Provides immediate error feedback for schema violations
 * - Supports custom env and execution context per call
 *
 * @example
 * ```typescript
 * import { createLocalClient } from 'typed-routes';
 * import { api } from './api.js';
 *
 * const client = createLocalClient(api);
 *
 * // Configure default env/ctx for all calls
 * client.configure({ env: { DB: database } });
 *
 * // Call routes directly (no HTTP)
 * const users = await client.users.list();
 * const user = await client.users.get({ path: { id: '123' } });
 *
 * // Override env/ctx for a specific call
 * const result = await client.data.process({
 *   body: { items: [...] },
 *   env: { DB: testDatabase },
 * });
 * ```
 */

import type {
  Router,
  RouterRoutes,
  RouteDefinition,
  LocalClientConfig,
  LocalInvokeOptions,
  LocalRouterClient,
} from './types.js';
import { isRouter, isRoute } from './types.js';
import { compileSchema } from './schema.js';

/**
 * Creates a typed local client from a router definition.
 *
 * The local client mirrors the router's structure and invokes handlers directly
 * without HTTP overhead. Useful for testing and server-side operations.
 *
 * @param routerDef - The router definition to create a client for
 * @returns A typed client with a `configure` method and route methods
 *
 * @example
 * ```typescript
 * // Testing example
 * import { describe, it, expect } from 'vitest';
 * import { createLocalClient } from 'typed-routes';
 * import { api } from './api.js';
 *
 * describe('Users API', () => {
 *   const client = createLocalClient(api);
 *   client.configure({ env: { DB: mockDatabase } });
 *
 *   it('creates a user', async () => {
 *     const user = await client.users.create({
 *       body: { name: 'Alice', email: 'alice@example.com' },
 *     });
 *     expect(user.name).toBe('Alice');
 *   });
 * });
 *
 * // Server-side rendering example
 * const client = createLocalClient(api);
 * client.configure({ env: { DB: database } });
 *
 * async function getServerSideProps() {
 *   const data = await client.posts.list({ query: { limit: 10 } });
 *   return { props: { posts: data } };
 * }
 * ```
 */
export function createLocalClient<T extends RouterRoutes>(
  routerDef: Router<T>
): LocalRouterClient<T> {
  return buildClient(routerDef, '', { current: {} });
}

/** Internal: builds client recursively with shared config. */
function buildClient<T extends RouterRoutes>(
  routerDef: Router<T>,
  parentPath: string,
  sharedConfig: { current: LocalClientConfig }
): LocalRouterClient<T> {
  const fullBasePath = parentPath + routerDef.basePath;

  const client = {
    configure(config: LocalClientConfig) {
      Object.assign(sharedConfig.current, config);
    },
  } as LocalRouterClient<T>;

  populateRoutes(client, routerDef, fullBasePath, sharedConfig);

  return client;
}

/** Populates route methods on a local client object. */
function populateRoutes<T extends RouterRoutes>(
  target: Record<string, unknown>,
  routerDef: Router<T>,
  basePath: string,
  sharedConfig: { current: LocalClientConfig }
): void {
  for (const [key, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      const nested = {} as Record<string, unknown>;
      populateRoutes(nested, entry, basePath + entry.basePath, sharedConfig);
      target[key] = nested;
    } else if (isRoute(entry)) {
      target[key] = createLocalRouteInvoker(entry, basePath, sharedConfig);
    }
  }
}

/**
 * Extracts path parameter names from a route path.
 *
 * @example
 * extractPathParamNames('/users/:id/posts/:postId') // ['id', 'postId']
 */
function extractPathParamNames(path: string): string[] {
  const matches = path.matchAll(/:(\w+)/g);
  return Array.from(matches, (m) => m[1]);
}

/**
 * Substitutes path parameters into a route path template.
 *
 * @example
 * substitutePathParams('/users/:id', { id: '123' }) // '/users/123'
 */
function substitutePathParams(pathTemplate: string, params: Record<string, string>): string {
  return pathTemplate.replace(/:(\w+)/g, (_, name) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter: ${name}`);
    }
    return encodeURIComponent(value);
  });
}

/** Creates a local invoker function for a route. */
function createLocalRouteInvoker(
  routeDef: RouteDefinition,
  basePath: string,
  sharedConfig: { current: LocalClientConfig }
): (options?: LocalInvokeOptions) => Promise<unknown> {
  // Pre-extract path param names for this route.
  const fullPathTemplate = basePath + routeDef.path;
  const pathParamNames = extractPathParamNames(fullPathTemplate);

  const routeId = `${routeDef.method.toUpperCase()} ${fullPathTemplate}`;

  return async (options: LocalInvokeOptions = {}) => {
    const config = sharedConfig.current;

    // Substitute path parameters into the URL.
    const pathParams = (options.path ?? {}) as Record<string, string>;
    const fullPath = substitutePathParams(fullPathTemplate, pathParams);

    // Validate query params.
    let query = {};
    if (routeDef.query) {
      const querySchema = compileSchema(routeDef.query);
      const result = querySchema.safeParse(options.query ?? {});
      if (!result.success) {
        throw new Error(`[${routeId}] Invalid query parameters: ${JSON.stringify(result.error.flatten())}`);
      }
      query = result.data;
    }

    // Validate body.
    let body = {};
    if (routeDef.body && ['post', 'put', 'patch'].includes(routeDef.method)) {
      const bodySchema = compileSchema(routeDef.body);
      const result = bodySchema.safeParse(options.body ?? {});
      if (!result.success) {
        throw new Error(`[${routeId}] Invalid request body: ${JSON.stringify(result.error.flatten())}`);
      }
      body = result.data;
    }

    // Build synthetic request.
    const url = new URL(fullPath, 'http://localhost');
    if (options.query && typeof options.query === 'object') {
      for (const [key, value] of Object.entries(options.query as Record<string, unknown>)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const requestInit: RequestInit = {
      method: routeDef.method.toUpperCase(),
    };
    if (options.body && ['post', 'put', 'patch'].includes(routeDef.method)) {
      requestInit.headers = { 'Content-Type': 'application/json' };
      requestInit.body = JSON.stringify(options.body);
    }

    const request = new Request(url.toString(), requestInit);

    // Call handler directly.
    if (!routeDef.handler) {
      return {};
    }

    // Build unified handler context with flattened params.
    const context = {
      request,
      path: pathParams,
      query,
      body,
      env: options.env ?? config.env,
      executionCtx: options.ctx ?? config.ctx,
    } as Parameters<typeof routeDef.handler>[0];

    const result = await routeDef.handler(context);

    // If handler returned a Response, parse it to match httpClient behavior.
    // If handler returned a plain object, return it directly.
    if (result instanceof Response) {
      return result.json();
    }
    return result;
  };
}

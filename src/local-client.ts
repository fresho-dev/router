/**
 * @fileoverview Local client implementation.
 *
 * Provides typed local client that invokes handlers directly without HTTP.
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

/** Creates a local client from a router. */
export function createLocalRouterClient<T extends RouterRoutes>(
  routerDef: Router<T>,
  parentPath = '',
  sharedConfig: { current: LocalClientConfig } = { current: {} }
): LocalRouterClient<T> {
  const fullBasePath = parentPath + routerDef.basePath;

  const client = {
    configure(config: LocalClientConfig) {
      Object.assign(sharedConfig.current, config);
    },
  } as LocalRouterClient<T>;

  populateLocalClientRoutes(client, routerDef, fullBasePath, sharedConfig);

  return client;
}

/** Populates route methods on a local client object. */
function populateLocalClientRoutes<T extends RouterRoutes>(
  target: Record<string, unknown>,
  routerDef: Router<T>,
  basePath: string,
  sharedConfig: { current: LocalClientConfig }
): void {
  for (const [key, entry] of Object.entries(routerDef.routes)) {
    if (isRouter(entry)) {
      const nested = {} as Record<string, unknown>;
      populateLocalClientRoutes(nested, entry, basePath + entry.basePath, sharedConfig);
      target[key] = nested;
    } else if (isRoute(entry)) {
      target[key] = createLocalRouteInvoker(entry, basePath, sharedConfig);
    }
  }
}

/** Creates a local invoker function for a route. */
function createLocalRouteInvoker(
  routeDef: RouteDefinition,
  basePath: string,
  sharedConfig: { current: LocalClientConfig }
): (options?: LocalInvokeOptions<unknown, unknown>) => Promise<unknown> {
  return async (options: LocalInvokeOptions<unknown, unknown> = {}) => {
    const config = sharedConfig.current;
    const fullPath = basePath + routeDef.path;

    // Validate query params.
    let query = {};
    if (routeDef.query) {
      const querySchema = compileSchema(routeDef.query);
      const result = querySchema.safeParse(options.query ?? {});
      if (!result.success) {
        throw new Error(`Invalid query parameters: ${JSON.stringify(result.error.flatten())}`);
      }
      query = result.data;
    }

    // Validate body.
    let body = {};
    if (routeDef.body && ['post', 'put', 'patch'].includes(routeDef.method)) {
      const bodySchema = compileSchema(routeDef.body);
      const result = bodySchema.safeParse(options.body ?? {});
      if (!result.success) {
        throw new Error(`Invalid request body: ${JSON.stringify(result.error.flatten())}`);
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

    const env = options.env ?? config.env;
    const ctx = options.ctx ?? config.ctx;
    const response = await routeDef.handler(request, { query, body }, env, ctx);

    // Parse response to match httpClient behavior.
    return response.json();
  };
}

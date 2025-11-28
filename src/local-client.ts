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
): (options?: LocalInvokeOptions<unknown, unknown, unknown>) => Promise<unknown> {
  // Pre-extract path param names for this route.
  const fullPathTemplate = basePath + routeDef.path;
  const pathParamNames = extractPathParamNames(fullPathTemplate);

  const routeId = `${routeDef.method.toUpperCase()} ${fullPathTemplate}`;

  return async (options: LocalInvokeOptions<unknown, unknown, unknown> = {}) => {
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

    // Build unified handler context with path params.
    const context = {
      request,
      params: { path: pathParams, query, body },
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

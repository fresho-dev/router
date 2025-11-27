/**
 * @fileoverview Core route and router creation functions.
 *
 * Provides the main API for defining routes and composing routers.
 */

import type { SchemaDefinition } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';
import type { Middleware } from './middleware.js';
import { createHttpRouterClient } from './http-client.js';
import { createLocalRouterClient } from './local-client.js';

/** Creates a route definition. */
export function route<const Q extends SchemaDefinition, const B extends SchemaDefinition>(
  definition: RouteDefinition<Q, B>
): RouteDefinition<Q, B> {
  return definition;
}

/** Creates a composable router. */
export function router<T extends RouterRoutes>(
  basePath: string,
  routes: T,
  middleware?: Middleware[]
): Router<T> {
  return {
    basePath,
    routes,
    middleware,
    httpClient() {
      return createHttpRouterClient(this);
    },
    localClient() {
      return createLocalRouterClient(this);
    },
  };
}

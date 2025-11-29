/**
 * @fileoverview Core route and router creation functions.
 *
 * Provides the main API for defining routes and composing routers.
 */

import type { SchemaDefinition } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';
import type { Middleware } from './middleware.js';
import { createHandler } from './handler.js';

/** Creates a route definition with inferred types. */
export function route<
  const P extends string,
  const Q extends SchemaDefinition,
  const B extends SchemaDefinition,
  R = unknown,
>(definition: RouteDefinition<P, Q, B, R, {}>): RouteDefinition<P, Q, B, R, {}> {
  return definition;
}

/**
 * Creates a route with typed context.
 *
 * Use this when you need typed access to env bindings and/or middleware-added properties.
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   env: { KV: KVNamespace; DB: D1Database };
 *   user: { id: string; name: string };
 * }
 *
 * const profile = route.ctx<AppContext>()({
 *   method: 'get',
 *   path: '/profile',
 *   handler: async (c) => {
 *     c.env.KV;    // typed
 *     c.user.name; // typed
 *     return { name: c.user.name };
 *   },
 * });
 * ```
 */
route.ctx = function <Ctx>() {
  return <const P extends string, const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
    definition: RouteDefinition<P, Q, B, R, Ctx>
  ): RouteDefinition<P, Q, B, R, Ctx> => definition;
};


/** Creates a composable router. */
export function router<T extends RouterRoutes, M extends Middleware<unknown>[]>(
  basePath: string,
  routes: T,
  middleware?: [...M]
): Router<T> {
  const self: Router<T> = {
    basePath,
    routes,
    middleware,
    handler() {
      return createHandler(self);
    },
  };
  return self;
}

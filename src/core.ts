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

/** Return type of route.ctx<T>() - callable and chainable. */
interface CtxBuilder<Ctx> {
  /** Create a route with the accumulated context type. */
  <const P extends string, const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
    definition: RouteDefinition<P, Q, B, R, Ctx>
  ): RouteDefinition<P, Q, B, R, Ctx>;

  /** Chain additional context types. */
  ctx<AdditionalCtx>(): CtxBuilder<Ctx & AdditionalCtx>;
}

/** Creates a chainable context builder. */
function createCtxBuilder<Ctx>(): CtxBuilder<Ctx> {
  const builder = <
    const P extends string,
    const Q extends SchemaDefinition,
    const B extends SchemaDefinition,
    R = unknown,
  >(
    definition: RouteDefinition<P, Q, B, R, Ctx>
  ): RouteDefinition<P, Q, B, R, Ctx> => definition;

  builder.ctx = <AdditionalCtx>() => createCtxBuilder<Ctx & AdditionalCtx>();

  return builder as CtxBuilder<Ctx>;
}

/**
 * Creates a route with typed context.
 *
 * Use this when you need typed access to env bindings and/or middleware-added properties.
 * Supports chaining multiple .ctx<>() calls to compose context types.
 *
 * @example
 * ```typescript
 * // Single context type
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
 *
 * // Chained context types
 * interface EnvContext { env: { DB: D1Database } }
 * interface AuthContext { user: { id: string } }
 *
 * const data = route.ctx<EnvContext>().ctx<AuthContext>()({
 *   method: 'get',
 *   path: '/data',
 *   handler: async (c) => {
 *     c.env.DB;  // typed from EnvContext
 *     c.user.id; // typed from AuthContext
 *     return { userId: c.user.id };
 *   },
 * });
 * ```
 */
route.ctx = function <Ctx>(): CtxBuilder<Ctx> {
  return createCtxBuilder<Ctx>();
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

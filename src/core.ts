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

/** Creates a route definition with inferred types. */
export function route<
  const P extends string,
  const Q extends SchemaDefinition,
  const B extends SchemaDefinition,
  R = unknown,
>(definition: RouteDefinition<P, Q, B, unknown, R, {}>): RouteDefinition<P, Q, B, unknown, R, {}> {
  return definition;
}

/** Route builder with typed env, ready to accept context or definition. */
interface RouteBuilderWithEnv<Env> {
  /** Add typed middleware context extensions. */
  ctx: <Ext>() => <
    const P extends string,
    const Q extends SchemaDefinition,
    const B extends SchemaDefinition,
    R = unknown,
  >(definition: RouteDefinition<P, Q, B, Env, R, Ext>) => RouteDefinition<P, Q, B, Env, R, Ext>;

  /** Create route with just env typing (no middleware context). */
  <const P extends string, const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
    definition: RouteDefinition<P, Q, B, Env, R, {}>
  ): RouteDefinition<P, Q, B, Env, R, {}>;
}

/**
 * Creates a route with typed environment bindings.
 *
 * Use this to type `c.env` in your handlers (e.g., Cloudflare Workers bindings).
 * Can be chained with `.ctx<T>()` to also type middleware context extensions.
 *
 * @example
 * ```typescript
 * interface Env {
 *   KV: KVNamespace;
 *   DB: D1Database;
 * }
 *
 * // Just env
 * const getData = route.env<Env>()({
 *   method: 'get',
 *   path: '/data',
 *   handler: async (c) => {
 *     const value = await c.env.KV.get('key'); // typed!
 *     return { value };
 *   },
 * });
 *
 * // Env + middleware context
 * interface AuthContext {
 *   user: { id: string };
 * }
 *
 * const profile = route.env<Env>().ctx<AuthContext>()({
 *   method: 'get',
 *   path: '/profile',
 *   handler: async (c) => {
 *     await c.env.DB.prepare('...').bind(c.user.id); // both typed!
 *   },
 * });
 * ```
 */
route.env = function <Env>(): RouteBuilderWithEnv<Env> {
  const builder = <
    const P extends string,
    const Q extends SchemaDefinition,
    const B extends SchemaDefinition,
    R = unknown,
  >(definition: RouteDefinition<P, Q, B, Env, R, {}>): RouteDefinition<P, Q, B, Env, R, {}> => definition;

  builder.ctx = function <Ext>() {
    return <const P extends string, const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
      definition: RouteDefinition<P, Q, B, Env, R, Ext>
    ): RouteDefinition<P, Q, B, Env, R, Ext> => definition;
  };

  return builder as RouteBuilderWithEnv<Env>;
};

/**
 * Creates a route with typed middleware context extensions.
 *
 * Use this when middleware adds properties to the context that handlers need.
 * For typing env bindings, use `route.env<E>()` or `route.env<E>().ctx<C>()`.
 *
 * @example
 * ```typescript
 * interface AuthContext {
 *   user: { id: string; name: string };
 * }
 *
 * const profile = route.ctx<AuthContext>()({
 *   method: 'get',
 *   path: '/profile',
 *   handler: async (c) => {
 *     return { name: c.user.name }; // c.user is typed
 *   },
 * });
 * ```
 */
route.ctx = function <Ext>() {
  return <const P extends string, const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
    definition: RouteDefinition<P, Q, B, unknown, R, Ext>
  ): RouteDefinition<P, Q, B, unknown, R, Ext> => definition;
};


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

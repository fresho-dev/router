/**
 * @fileoverview Core route and router creation functions.
 *
 * Provides the main API for defining routes and composing routers.
 */

import type { SchemaDefinition } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';
import type { Middleware } from './middleware.js';
import { createHandler } from './handler.js';

/**
 * Creates a route definition with fully inferred types.
 *
 * The simplest way to define a route. Path parameters, query schemas, body schemas,
 * and return types are all inferred automatically.
 *
 * @param definition - The route configuration (method, path, query, body, handler)
 * @returns The route definition with inferred types
 *
 * @example
 * ```typescript
 * // Basic GET route
 * const getUsers = route({
 *   method: 'get',
 *   path: '/users',
 *   handler: async () => [{ id: '1', name: 'Alice' }],
 * });
 *
 * // Route with path parameters (inferred from :param syntax)
 * const getUser = route({
 *   method: 'get',
 *   path: '/users/:id',
 *   handler: async (c) => {
 *     c.path.id;  // string - inferred from path
 *     return { id: c.path.id };
 *   },
 * });
 *
 * // Route with query and body validation
 * const createUser = route({
 *   method: 'post',
 *   path: '/users',
 *   query: { notify: 'boolean?' },           // optional boolean
 *   body: { name: 'string', age: 'number' }, // required fields
 *   handler: async (c) => {
 *     c.query.notify;  // boolean | undefined
 *     c.body.name;     // string
 *     c.body.age;      // number
 *     return { id: '123', ...c.body };
 *   },
 * });
 * ```
 *
 * @see {@link route.ctx} for routes that need typed context (env, middleware props)
 */
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


/**
 * Creates a composable router with optional middleware.
 *
 * Routers group related routes under a common base path and can apply middleware
 * to all routes within. Routers can be nested to create hierarchical APIs.
 *
 * @param basePath - URL prefix for all routes in this router (e.g., '/api', '/users')
 * @param routes - Object mapping route names to route definitions or nested routers
 * @param middleware - Optional middleware functions applied to all routes (in order)
 * @returns A router object with a `.handler()` method for use with fetch-based servers
 *
 * @example
 * ```typescript
 * // Simple router
 * const api = router('/api', {
 *   health: route({ method: 'get', path: '/health', handler: async () => ({ ok: true }) }),
 *   users: route({ method: 'get', path: '/users', handler: async () => [] }),
 * });
 *
 * // Router with middleware
 * const protectedApi = router('/api', {
 *   profile: route.ctx<{ user: User }>()({
 *     method: 'get',
 *     path: '/profile',
 *     handler: async (c) => ({ id: c.user.id }),
 *   }),
 * }, jwtAuth({ secret, claims: (p) => ({ user: { id: p.sub } }) }));
 *
 * // Nested routers for hierarchy
 * const usersRouter = router('/users', {
 *   list: route({ method: 'get', path: '', handler: async () => [] }),
 *   get: route({ method: 'get', path: '/:id', handler: async (c) => ({ id: c.path.id }) }),
 * });
 *
 * const api = router('/api', {
 *   users: usersRouter,  // Routes: GET /api/users, GET /api/users/:id
 * });
 *
 * // Use with Cloudflare Workers, Deno, Bun, or any fetch-based server
 * export default { fetch: api.handler() };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function router<T extends RouterRoutes, M extends Middleware<any>[]>(
  basePath: string,
  routes: T,
  ...middleware: M
): Router<T> {
  const self: Router<T> = {
    basePath,
    routes,
    middleware: middleware.length > 0 ? middleware : undefined,
    handler() {
      return createHandler(self);
    },
  };
  return self;
}

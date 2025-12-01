/**
 * @fileoverview Core route and router creation functions.
 *
 * ## Path Convention
 * - Property names = URL path segments
 * - `$param` prefix = dynamic segment (`:param`)
 * - `get`, `post`, `put`, `patch`, `delete` = HTTP method handlers
 *
 * ## Typing Best Practices
 *
 * **Schemas** (`query`/`body`) provide runtime validation AND type inference.
 * Use them for any input that needs validation:
 * ```typescript
 * get: route({
 *   query: { limit: 'number?' },
 *   handler: async (c) => c.query.limit,  // limit: number | undefined
 * })
 * ```
 *
 * **Context** (`route.ctx<T>()`) provides types only (no validation).
 * Use it for path params, env bindings, and middleware-injected values:
 * ```typescript
 * interface MyContext {
 *   path: { id: string };
 *   env: { DB: Database };
 *   user: { name: string };  // from auth middleware
 * }
 * get: route.ctx<MyContext>()({
 *   handler: async (c) => ({ id: c.path.id, user: c.user.name }),
 * })
 * ```
 *
 * **Important:** Don't add explicit type annotations to handler parameters.
 * Let types flow from schemas and context:
 * ```typescript
 * // GOOD: types inferred from schema
 * handler: async (c) => c.query.limit
 *
 * // BAD: redundant type annotation
 * handler: async (c: { query: { limit?: number } }) => c.query.limit
 * ```
 */

import type { SchemaDefinition } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';
import { ROUTE_MARKER, ROUTER_MARKER } from './types.js';
import type { Middleware } from './middleware.js';
import { createHandler } from './handler.js';

/**
 * Creates a route with query/body validation schemas.
 *
 * Use `route()` when you need request validation. For simple handlers
 * without validation, you can use bare functions directly in the router.
 *
 * @example
 * ```typescript
 * // Route with query validation
 * get: route({
 *   query: { limit: 'number?', offset: 'number?' },
 *   handler: async (c) => {
 *     const items = await db.list(c.query.limit, c.query.offset);
 *     return { items };
 *   },
 * })
 *
 * // Route with body validation
 * post: route({
 *   body: { name: 'string', email: 'string' },
 *   handler: async (c) => {
 *     const user = await db.create(c.body);
 *     return user;
 *   },
 * })
 *
 * // Simple handler without validation (bare function)
 * get: async () => ({ status: 'ok' })
 * ```
 */
export function route<
  const Q extends SchemaDefinition,
  const B extends SchemaDefinition,
  R = unknown,
>(definition: RouteDefinition<Q, B, R, {}, {}>): RouteDefinition<Q, B, R, {}, {}> {
  return { ...definition, [ROUTE_MARKER]: true } as RouteDefinition<Q, B, R, {}, {}>;
}

/** Return type of route.ctx<T>() - callable and chainable. */
interface CtxBuilder<Ctx> {
  <const Q extends SchemaDefinition, const B extends SchemaDefinition, R = unknown>(
    definition: RouteDefinition<Q, B, R, {}, Ctx>
  ): RouteDefinition<Q, B, R, {}, Ctx>;

  ctx<AdditionalCtx>(): CtxBuilder<Ctx & AdditionalCtx>;
}

/** Creates a chainable context builder. */
function createCtxBuilder<Ctx>(): CtxBuilder<Ctx> {
  const builder = <
    const Q extends SchemaDefinition,
    const B extends SchemaDefinition,
    R = unknown,
  >(
    definition: RouteDefinition<Q, B, R, {}, Ctx>
  ): RouteDefinition<Q, B, R, {}, Ctx> =>
    ({ ...definition, [ROUTE_MARKER]: true }) as RouteDefinition<Q, B, R, {}, Ctx>;

  builder.ctx = <AdditionalCtx>() => createCtxBuilder<Ctx & AdditionalCtx>();

  return builder as CtxBuilder<Ctx>;
}

/**
 * Creates a route with typed context for values not covered by schemas.
 *
 * Use `route.ctx<T>()` to type:
 * - **Path params**: `{ path: { id: string } }` for `$id` segments
 * - **Env bindings**: `{ env: { DB: Database } }` for runtime environment
 * - **Middleware values**: `{ user: User }` for auth middleware, etc.
 *
 * Context provides types only, not runtime validation. For validated inputs,
 * use `query` and `body` schemas instead.
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   path: { id: string };
 *   env: { DB: D1Database };
 *   user: { id: string };  // injected by auth middleware
 * }
 *
 * $id: router({
 *   get: route.ctx<AppContext>()({
 *     query: { include: 'string?' },  // schema for validation
 *     handler: async (c) => {
 *       // c.path.id, c.env.DB, c.user.id - from context
 *       // c.query.include - from schema
 *       return c.env.DB.get(c.path.id);
 *     },
 *   }),
 * })
 * ```
 */
route.ctx = function <Ctx>(): CtxBuilder<Ctx> {
  return createCtxBuilder<Ctx>();
};

/**
 * Creates a router that groups paths and applies middleware.
 *
 * @example
 * ```typescript
 * const api = router({
 *   health: router({
 *     get: async () => ({ status: 'ok' }),
 *   }),
 *
 *   users: router({
 *     // GET /users - list users
 *     get: route({
 *       query: { limit: 'number?' },
 *       handler: async (c) => db.users.list(c.query.limit),
 *     }),
 *
 *     // POST /users - create user
 *     post: route({
 *       body: { name: 'string', email: 'string' },
 *       handler: async (c) => db.users.create(c.body),
 *     }),
 *
 *     // /users/:id
 *     $id: router({
 *       get: async (c) => db.users.get(c.path.id),
 *       delete: async (c) => db.users.delete(c.path.id),
 *     }),
 *   }),
 * });
 *
 * export default { fetch: api.handler() };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function router<T extends RouterRoutes, M extends Middleware<any>[]>(
  routes: T,
  ...middleware: M
): Router<T> {
  const self: Router<T> = {
    routes,
    middleware: middleware.length > 0 ? middleware : undefined,
    handler() {
      return createHandler(self);
    },
  };
  // Add marker for type checking.
  (self as unknown as Record<symbol, boolean>)[ROUTER_MARKER] = true;
  return self;
}

/**
 * @fileoverview Core type definitions for the routing library.
 *
 * **Path Convention:**
 * - Property names = URL path segments
 * - `$param` prefix = dynamic segment (`:param`)
 * - `get`, `post`, `put`, `patch`, `delete` = HTTP method handlers
 *
 * **Structure:**
 * - `router({ ... })` - groups paths, can have middleware
 * - `route({ query?, body?, handler })` - single method with schemas
 * - Bare functions as shorthand for handlers without schemas
 */

import type { SchemaDefinition, InferSchema } from './schema.js';
import type { Middleware } from './middleware.js';

/** Standard HTTP methods. */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/** HTTP method property names. */
export const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

/** Symbol to mark an object as a route definition. */
export const ROUTE_MARKER = Symbol.for('typed-routes:route');

/** Symbol to mark an object as a router. */
export const ROUTER_MARKER = Symbol.for('typed-routes:router');

/**
 * Extracts the parameter name from a `$param` property name.
 */
export type ExtractParamFromProperty<T extends string> =
  T extends `$${infer Param}` ? Param : never;

/**
 * Checks if a property name is a dynamic parameter (starts with $).
 */
export type IsParamProperty<T extends string> = T extends `$${string}` ? true : false;

/**
 * Collects path params from a property path array.
 */
export type CollectPathParams<Path extends string[]> =
  Path extends [infer Head extends string, ...infer Rest extends string[]]
    ? (Head extends `$${infer Param}` ? { [K in Param]: string } : {}) & CollectPathParams<Rest>
    : {};

/** Execution context for background tasks (Cloudflare Workers compatible). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Unified context object passed to handlers.
 */
export type Context<
  Q = unknown,
  B = unknown,
  P extends Record<string, string> = Record<string, string>,
  Ctx = {},
> = {
  /** The original Request. */
  request: Request;
  /** URL path parameters from `$param` segments. */
  path: P;
  /** Query string parameters. */
  query: Q;
  /** Request body. */
  body: B;
  /** Execution context for background tasks. */
  executionCtx?: ExecutionContext;
  /** Environment bindings. */
  env: Ctx extends { env: infer E } ? E : unknown;
} & Omit<Ctx, 'env'>;

/**
 * Typed response wrapper that carries the response body type.
 */
export type TypedResponse<T> = Response & { __responseType?: T };

/**
 * Handler function type.
 */
export type TypedHandler<
  Q = unknown,
  B = unknown,
  P extends Record<string, string> = Record<string, string>,
  R = unknown,
  Ctx = {},
> = (context: Context<Q, B, P, Ctx>) => R | Response | TypedResponse<R> | Promise<R | Response | TypedResponse<R>>;

/**
 * Route definition - a single HTTP method handler with optional schemas.
 *
 * Use `route()` when you need query or body validation schemas.
 * For simple handlers without schemas, use bare functions in the router.
 *
 * @example
 * ```typescript
 * // With schemas
 * get: route({
 *   query: { limit: 'number?' },
 *   handler: async (c) => ({ items: [], limit: c.query.limit }),
 * })
 *
 * // Without schemas (bare function shorthand)
 * get: async (c) => ({ items: [] })
 * ```
 */
export interface RouteDefinition<
  Q extends SchemaDefinition = {},
  B extends SchemaDefinition = {},
  R = unknown,
  P extends Record<string, string> = Record<string, string>,
  Ctx = {},
> {
  /** Query parameter schema for validation. */
  query?: Q;
  /** Request body schema for validation. */
  body?: B;
  /** Optional description for documentation. */
  description?: string;
  /** The request handler function. */
  handler: TypedHandler<InferSchema<Q>, InferSchema<B>, P, R, Ctx>;
}

/** A bare handler function (shorthand for route without schemas). */
export type BareHandler = (context: Context<unknown, unknown, Record<string, string>, unknown>) => unknown;

/** Checks if a value is a function. */
export function isFunction(value: unknown): value is BareHandler {
  return typeof value === 'function';
}

/** Checks if entry is a Route (marked with ROUTE_MARKER). */
export function isRoute(entry: unknown): entry is RouteDefinition {
  return typeof entry === 'object' && entry !== null && ROUTE_MARKER in entry;
}

/** Checks if entry is a Router (marked with ROUTER_MARKER). */
export function isRouter(entry: unknown): entry is Router<RouterRoutes> {
  return typeof entry === 'object' && entry !== null && ROUTER_MARKER in entry;
}

/**
 * A method handler - either a route with schemas or a bare function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MethodEntry = RouteDefinition<any, any, any, any, any> | BareHandler;

/**
 * Router routes record.
 *
 * Can contain:
 * - `get`, `post`, `put`, `patch`, `delete` - method handlers (route or function)
 * - Other property names - nested routers (path segments)
 * - `$param` properties - dynamic path segments
 */
export type RouterRoutes = {
  get?: MethodEntry;
  post?: MethodEntry;
  put?: MethodEntry;
  patch?: MethodEntry;
  delete?: MethodEntry;
  options?: MethodEntry;
  head?: MethodEntry;
} & {
  [key: string]: MethodEntry | Router<RouterRoutes>;
};

/** Handler function signature for the standalone router. */
export type FetchHandler = (
  request: Request,
  env?: unknown,
  ctx?: ExecutionContext
) => Response | Promise<Response>;

/**
 * Router - groups paths and can have middleware.
 *
 * @example
 * ```typescript
 * const api = router({
 *   // Method handlers for this path
 *   get: async (c) => [...],
 *   post: route({ body: { name: 'string' }, handler: async (c) => c.body }),
 *
 *   // Nested path segments
 *   users: router({
 *     get: async (c) => [...],
 *     $id: router({
 *       get: async (c) => ({ id: c.path.id }),
 *     }),
 *   }),
 * });
 * ```
 */
export interface Router<T extends RouterRoutes> {
  /** Route definitions and nested routers. */
  readonly routes: T;
  /** Middleware applied to all routes in this router. */
  readonly middleware?: Middleware[];
  /**
   * Creates a fetch handler for use with Cloudflare Workers, Deno, Bun, etc.
   */
  handler(): FetchHandler;
}

/**
 * @fileoverview Core type definitions for the routing library.
 *
 * Contains all type definitions used across modules.
 */

import type { SchemaDefinition, InferSchema } from './schema.js';
import type { Middleware } from './middleware.js';

/** Standard HTTP methods. */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/**
 * Extracts path parameters from a route path string.
 *
 * @example
 * ```typescript
 * type Params = ExtractPathParams<'/users/:id'>
 * // Result: { id: string }
 *
 * type Params2 = ExtractPathParams<'/users/:userId/posts/:postId'>
 * // Result: { userId: string; postId: string }
 *
 * type NoParams = ExtractPathParams<'/users'>
 * // Result: {}
 * ```
 */
/**
 * Delimiters that terminate a path parameter name.
 *
 * When parsing `:param` in a path, the param name ends at the first delimiter.
 * This allows patterns like `/files/:name.pdf` where `.pdf` is a literal suffix.
 */
type Delimiter = '/' | '.' | '-';

/**
 * Extracts a parameter name from a string, stopping at the first delimiter.
 *
 * Uses character-by-character recursion to achieve non-greedy matching, since
 * TypeScript's template literal inference is greedy by default.
 *
 * @typeParam T - The string to extract from (everything after the `:`)
 * @typeParam Acc - Accumulator for characters seen so far (internal, starts empty)
 * @returns A tuple of [paramName, remainingString]
 *
 * @example
 * ```typescript
 * type R1 = ExtractParamName<'id'>        // ['id', '']
 * type R2 = ExtractParamName<'name.pdf'>  // ['name', '.pdf']
 * type R3 = ExtractParamName<'a-:b.mp3'>  // ['a', '-:b.mp3']
 * ```
 */
type ExtractParamName<T extends string, Acc extends string = ''> =
  T extends `${infer C}${infer Rest}`
    ? C extends Delimiter
      ? [Acc, `${C}${Rest}`]  // Hit delimiter: return accumulated name + rest
      : ExtractParamName<Rest, `${Acc}${C}`>  // Continue: add char to accumulator
    : [Acc, ''];  // End of string: return accumulated name

/**
 * Extracts path parameters from a route path string.
 *
 * Parses `:param` segments and returns a type representing all parameters.
 * Handles parameters followed by literal suffixes (e.g., `.pdf`, `-suffix`).
 *
 * The runtime `pathToRegex` function in standalone.ts uses the same logic:
 * params are `:[a-zA-Z0-9_]+` and literals (including `.`, `-`) are escaped.
 *
 * @example
 * ```typescript
 * // Simple params
 * type T1 = ExtractPathParams<'/users/:id'>
 * // Result: { id: string }
 *
 * // Multiple params
 * type T2 = ExtractPathParams<'/users/:userId/posts/:postId'>
 * // Result: { userId: string; postId: string }
 *
 * // Params with file extensions
 * type T3 = ExtractPathParams<'/files/:name.pdf'>
 * // Result: { name: string }
 *
 * // Multiple params with delimiters
 * type T4 = ExtractPathParams<'/audio/:artist-:track.mp3'>
 * // Result: { artist: string; track: string }
 *
 * // No params
 * type T5 = ExtractPathParams<'/static/page'>
 * // Result: {}
 * ```
 */
export type ExtractPathParams<T extends string> =
  T extends `${string}:${infer Rest}`
    ? ExtractParamName<Rest> extends [infer Param extends string, infer Remaining extends string]
      ? { [K in Param]: string } & ExtractPathParams<Remaining>
      : {}
    : {};

/** Execution context for background tasks (Cloudflare Workers compatible). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Unified context object passed to handlers.
 *
 * Contains the request, validated params (path, query, body), env, and middleware-added properties.
 *
 * @typeParam Q - Query parameter type
 * @typeParam B - Body type
 * @typeParam P - Path parameters (extracted from path string or Record<string, string>)
 * @typeParam Ctx - Context type including env and middleware-added properties
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   env: { KV: KVNamespace; DB: D1Database };
 *   user: { id: string; name: string };
 * }
 *
 * const handler = (c: Context<{ page?: number }, {}, '/users/:id', AppContext>) => {
 *   c.request;    // Original Request
 *   c.path.id;    // Typed path param
 *   c.query.page; // Typed query param
 *   c.env.KV;     // Typed env binding
 *   c.user;       // From middleware
 * };
 * ```
 */
export type Context<
  Q = unknown,
  B = unknown,
  P extends string | Record<string, string> = Record<string, string>,
  Ctx = {},
> = {
  /** The original Request (untouched). */
  request: Request;

  /** URL path parameters (e.g., { id: '123' } for /users/:id). */
  path: P extends string ? ExtractPathParams<P> : P;

  /** Query string parameters. */
  query: Q;

  /** Request body. */
  body: B;

  /** Execution context for background tasks (Cloudflare Workers). */
  executionCtx?: ExecutionContext;

  /** Environment bindings (Cloudflare Workers, Deno, etc.). */
  env: Ctx extends { env: infer E } ? E : unknown;
} & Omit<Ctx, 'env'>;

/**
 * Typed response wrapper that carries the response body type.
 *
 * This is a branded Response type that preserves the JSON body type for client inference.
 * At runtime it's just a standard Response, but TypeScript knows the body type.
 *
 * @example
 * ```typescript
 * const handler = () => {
 *   return Response.json({ id: '123', name: 'Alice' }) as TypedResponse<{ id: string; name: string }>;
 * };
 * ```
 */
export type TypedResponse<T> = Response & { __responseType?: T };

/**
 * Handler function with unified context argument and typed response.
 *
 * Receives a single Context object containing request, params, env, and middleware-added properties.
 * Returns either a raw Response, or a value that will be auto-wrapped in Response.json().
 *
 * @typeParam Q - Query parameter type
 * @typeParam B - Body type
 * @typeParam P - Path string for param extraction
 * @typeParam R - Response body type (inferred from return)
 * @typeParam Ctx - Context type including env and middleware-added properties
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   env: { DB: D1Database };
 *   user: { id: string };
 * }
 *
 * const handler: TypedHandler<{ page: number }, {}, '/users/:id', User, AppContext> = (c) => {
 *   c.request;           // Original Request
 *   c.path.id;    // Typed path param
 *   c.query.page; // Typed query param
 *   c.env.DB;            // Typed env binding
 *   c.user;              // From middleware
 *   return Response.json({ id: c.path.id });
 * };
 * ```
 */
export type TypedHandler<Q, B, P extends string = string, R = unknown, Ctx = {}> = (
  context: Context<Q, B, P, Ctx>
) => R | Response | TypedResponse<R> | Promise<R | Response | TypedResponse<R>>;

/** Route definition with optional handler and response type. */
export interface RouteDefinition<
  P extends string = string,
  Q extends SchemaDefinition = {},
  B extends SchemaDefinition = {},
  R = unknown,
  Ctx = {},
> {
  method: Method;
  path: P;
  query?: Q;
  body?: B;
  description?: string;
  handler?: TypedHandler<InferSchema<Q>, InferSchema<B>, P, R, Ctx>;
}

/** Base structure for route entries (excludes handler for type compatibility). */
export type BaseRoute = Omit<RouteDefinition, 'handler'> & { handler?: unknown };

/** A router entry is either a route or a nested router. */
export type RouterEntry = BaseRoute | Router<RouterRoutes>;

/** Router routes record. */
export type RouterRoutes = Record<string, RouterEntry>;

/** Checks if entry is a Router (has basePath property). */
export function isRouter(entry: unknown): entry is Router<RouterRoutes> {
  return typeof entry === 'object' && entry !== null && 'basePath' in entry;
}

/** Checks if entry is a Route (has method property). */
export function isRoute(entry: unknown): entry is RouteDefinition {
  return typeof entry === 'object' && entry !== null && 'method' in entry;
}

/** Handler function signature for the standalone router. */
export type FetchHandler = (
  request: Request,
  env?: unknown,
  ctx?: ExecutionContext
) => Response | Promise<Response>;

/** Router with base path and nested routes. */
export interface Router<T extends RouterRoutes> {
  readonly basePath: string;
  readonly routes: T;
  readonly middleware?: Middleware[];
  /** Returns a fetch handler for use with Cloudflare Workers, Deno, Bun, etc. */
  handler(): FetchHandler;
}

// =============================================================================
// Shared Client Types
// =============================================================================

/**
 * Base options with path params required when route has path params.
 *
 * Uses `{} extends ExtractPathParams<P>` check because `Record<string, never>` has a
 * string index signature, making `keyof` return `string` instead of `never`.
 */
type OptionsWithPath<
  Opts extends { path?: unknown },
  P extends string,
> = {} extends ExtractPathParams<P>
  ? Opts & { path?: never }
  : Omit<Opts, 'path'> & { path: ExtractPathParams<P> };

/**
 * Route client method signature based on path, query, body, and response types.
 *
 * Determines if options parameter is required or optional based on whether
 * the route has path params, query params, or body.
 */
type RouteClientMethod<
  P extends string,
  Q extends SchemaDefinition,
  B extends SchemaDefinition,
  R,
  Opts extends { path?: unknown; query?: unknown; body?: unknown },
> =
  // If no path params, options may be optional (depending on query/body).
  {} extends ExtractPathParams<P>
    ? keyof Q extends never
      ? keyof B extends never
        ? (options?: Opts & { path?: never; query?: never; body?: never }) => Promise<R>
        : (options: Opts & { path?: never; query?: never; body: InferSchema<B> }) => Promise<R>
      : keyof B extends never
        ? (options?: Opts & { path?: never; query?: InferSchema<Q>; body?: never }) => Promise<R>
        : (options: Opts & { path?: never; query?: InferSchema<Q>; body: InferSchema<B> }) => Promise<R>
    : // Has path params - options is always required.
      keyof Q extends never
      ? keyof B extends never
        ? (options: OptionsWithPath<Opts, P> & { query?: never; body?: never }) => Promise<R>
        : (options: OptionsWithPath<Opts, P> & { query?: never; body: InferSchema<B> }) => Promise<R>
      : keyof B extends never
        ? (options: OptionsWithPath<Opts, P> & { query?: InferSchema<Q>; body?: never }) => Promise<R>
        : (options: OptionsWithPath<Opts, P> & { query?: InferSchema<Q>; body: InferSchema<B> }) => Promise<R>;

// =============================================================================
// HTTP Client Types
// =============================================================================

/** HTTP client configuration. */
export interface HttpClientConfig {
  baseUrl?: string;
  headers?: HeadersInit;
}

/** HTTP fetch options for a route. */
export interface HttpFetchOptions {
  path?: Record<string, string>;
  query?: unknown;
  body?: unknown;
  headers?: HeadersInit;
}

/** HTTP client method for a single route. */
export type HttpRouteClient<
  P extends string,
  Q extends SchemaDefinition,
  B extends SchemaDefinition,
  R = unknown,
> = RouteClientMethod<P, Q, B, R, HttpFetchOptions>;

/** Nested routes without configure (used for nested routers). */
export type HttpRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer Routes>
    ? HttpRouterClientRoutes<Routes>
    : T[K] extends RouteDefinition<infer P, infer Q, infer B, infer R, infer _Ctx>
      ? HttpRouteClient<P, Q, B, R>
      : never;
};

/** Top-level HTTP client type for router (configure only at top level). */
export type HttpRouterClient<T extends RouterRoutes> = {
  configure(config: HttpClientConfig): void;
} & HttpRouterClientRoutes<T>;

// =============================================================================
// Local Client Types
// =============================================================================

/** Local client configuration. */
export interface LocalClientConfig {
  env?: unknown;
  ctx?: ExecutionContext;
}

/** Local invoke options for a route. */
export interface LocalInvokeOptions {
  path?: Record<string, string>;
  query?: unknown;
  body?: unknown;
  env?: unknown;
  ctx?: ExecutionContext;
}

/** Local client method for a single route. */
export type LocalRouteClient<
  P extends string,
  Q extends SchemaDefinition,
  B extends SchemaDefinition,
  R = unknown,
> = RouteClientMethod<P, Q, B, R, LocalInvokeOptions>;

/** Nested routes without configure (used for nested routers). */
export type LocalRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer Routes>
    ? LocalRouterClientRoutes<Routes>
    : T[K] extends RouteDefinition<infer P, infer Q, infer B, infer R, infer _Ctx>
      ? LocalRouteClient<P, Q, B, R>
      : never;
};

/** Top-level local client type for router (configure only at top level). */
export type LocalRouterClient<T extends RouterRoutes> = {
  configure(config: LocalClientConfig): void;
} & LocalRouterClientRoutes<T>;

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

/** Typed parameters passed to route handlers. */
export interface TypedParams<Q, B, P extends string | Record<string, string> = Record<string, string>> {
  /** URL path parameters (e.g., { id: '123' } for /books/:id). */
  path: P extends string ? ExtractPathParams<P> : P;
  /** Query string parameters. */
  query: Q;
  /** Request body. */
  body: B;
}

/** Execution context for background tasks (Cloudflare Workers compatible). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Unified context object passed to both middleware and handlers.
 *
 * Contains the request, validated params, runtime env, and middleware extensions.
 *
 * @typeParam Q - Query parameter type
 * @typeParam B - Body type
 * @typeParam P - Path parameters (extracted from path string or Record<string, string>)
 * @typeParam Env - Environment bindings type (Cloudflare env, etc.)
 * @typeParam Ext - Custom properties added by middleware
 *
 * @example
 * ```typescript
 * interface MyEnv {
 *   KV: KVNamespace;
 *   DB: D1Database;
 * }
 *
 * interface AuthContext {
 *   user: { id: string; name: string };
 * }
 *
 * const handler = (c: Context<{ page?: number }, {}, '/users/:id', MyEnv, AuthContext>) => {
 *   c.request;           // Original Request
 *   c.params.path.id;    // Typed path param
 *   c.params.query.page; // Typed query param
 *   c.env.KV;            // Typed env binding
 *   c.user;              // From middleware (via Ext)
 * };
 * ```
 */
export interface Context<
  Q = unknown,
  B = unknown,
  P extends string | Record<string, string> = Record<string, string>,
  Env = unknown,
  Ext = {},
> {
  /** The original Request (untouched). */
  request: Request;

  /** Validated and typed parameters. */
  params: TypedParams<Q, B, P>;

  /** Runtime environment (Cloudflare env, or custom). */
  env: Env;

  /** Execution context for background tasks (Cloudflare Workers). */
  executionCtx?: ExecutionContext;

  /** Response (set by handler or middleware, used for transformations). */
  res?: Response;
}

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
 * Receives a single Context object containing request, params, env, and middleware extensions.
 * Returns either a raw Response, or a value that will be auto-wrapped in Response.json().
 *
 * @typeParam Q - Query parameter type
 * @typeParam B - Body type
 * @typeParam P - Path string for param extraction
 * @typeParam Env - Environment bindings type
 * @typeParam R - Response body type (inferred from return)
 * @typeParam Ext - Middleware extension properties
 *
 * @example
 * ```typescript
 * const handler: TypedHandler<{ page: number }, {}, '/users/:id', MyEnv, User, { user: User }> = (c) => {
 *   c.request;           // Original Request
 *   c.params.path.id;    // Typed path param
 *   c.params.query.page; // Typed query param
 *   c.env.DB;            // Typed env binding
 *   c.user;              // From middleware (via Ext)
 *   return Response.json({ id: c.params.path.id });
 * };
 * ```
 */
export type TypedHandler<Q, B, P extends string = string, Env = unknown, R = unknown, Ext = {}> = (
  context: Context<Q, B, P, Env, Ext> & Ext
) => R | Response | TypedResponse<R> | Promise<R | Response | TypedResponse<R>>;

/** Route definition with optional handler and response type. */
export interface RouteDefinition<
  P extends string = string,
  Q extends SchemaDefinition = {},
  B extends SchemaDefinition = {},
  Env = unknown,
  R = unknown,
  Ext = {},
> {
  method: Method;
  path: P;
  query?: Q;
  body?: B;
  description?: string;
  handler?: TypedHandler<InferSchema<Q>, InferSchema<B>, P, Env, R, Ext>;
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

/** Router with base path and nested routes. */
export interface Router<T extends RouterRoutes> {
  readonly basePath: string;
  readonly routes: T;
  readonly middleware?: Middleware[];
  httpClient(): HttpRouterClient<T>;
  localClient(): LocalRouterClient<T>;
}

// =============================================================================
// HTTP Client Types
// =============================================================================

/** HTTP client configuration. */
export interface HttpClientConfig {
  baseUrl?: string;
  headers?: HeadersInit;
}

/** HTTP fetch options for a route. */
export interface HttpFetchOptions<Q, B, P = Record<string, string>> {
  /** Path parameters to substitute in the URL (e.g., { id: '123' } for /users/:id). */
  path?: P;
  query?: Q;
  body?: B;
  headers?: HeadersInit;
}

/**
 * HTTP fetch options with path params required when route has path params.
 *
 * Uses `{} extends ExtractPathParams<P>` check because `Record<string, never>` has a
 * string index signature, making `keyof` return `string` instead of `never`.
 */
export type HttpFetchOptionsWithPath<
  Q,
  B,
  P extends string,
> = {} extends ExtractPathParams<P>
  ? HttpFetchOptions<Q, B, never>
  : Omit<HttpFetchOptions<Q, B, ExtractPathParams<P>>, 'path'> & { path: ExtractPathParams<P> };

/** HTTP client method for a single route based on query, body, path, and response types. */
export type HttpRouteClient<
  P extends string,
  Q extends SchemaDefinition,
  B extends SchemaDefinition,
  R = unknown,
> =
  // If no path params ({} can satisfy the extracted type), options may be optional.
  {} extends ExtractPathParams<P>
    ? keyof Q extends never
      ? keyof B extends never
        ? (options?: HttpFetchOptions<never, never, never>) => Promise<R>
        : (options: HttpFetchOptions<never, InferSchema<B>, never>) => Promise<R>
      : keyof B extends never
        ? (options?: HttpFetchOptions<InferSchema<Q>, never, never>) => Promise<R>
        : (options: HttpFetchOptions<InferSchema<Q>, InferSchema<B>, never>) => Promise<R>
    : // Has path params - options is required with path
      keyof Q extends never
      ? keyof B extends never
        ? (options: HttpFetchOptionsWithPath<never, never, P>) => Promise<R>
        : (options: HttpFetchOptionsWithPath<never, InferSchema<B>, P>) => Promise<R>
      : keyof B extends never
        ? (options: HttpFetchOptionsWithPath<InferSchema<Q>, never, P>) => Promise<R>
        : (options: HttpFetchOptionsWithPath<InferSchema<Q>, InferSchema<B>, P>) => Promise<R>;

/** Nested routes without configure (used for nested routers). */
export type HttpRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer Routes>
    ? HttpRouterClientRoutes<Routes>
    : T[K] extends RouteDefinition<infer P, infer Q, infer B, infer R>
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
export interface LocalInvokeOptions<Q, B, P = Record<string, string>> {
  /** Path parameters to substitute in the URL. */
  path?: P;
  query?: Q;
  body?: B;
  env?: unknown;
  ctx?: ExecutionContext;
}

/**
 * Local invoke options with path params required when route has path params.
 *
 * Uses `{} extends ExtractPathParams<P>` check because `Record<string, never>` has a
 * string index signature, making `keyof` return `string` instead of `never`.
 */
export type LocalInvokeOptionsWithPath<
  Q,
  B,
  P extends string,
> = {} extends ExtractPathParams<P>
  ? LocalInvokeOptions<Q, B, never>
  : Omit<LocalInvokeOptions<Q, B, ExtractPathParams<P>>, 'path'> & { path: ExtractPathParams<P> };

/** Local client method for a single route based on query, body, path, and response types. */
export type LocalRouteClient<
  P extends string,
  Q extends SchemaDefinition,
  B extends SchemaDefinition,
  R = unknown,
> =
  // If no path params ({} can satisfy the extracted type), options may be optional.
  {} extends ExtractPathParams<P>
    ? keyof Q extends never
      ? keyof B extends never
        ? (options?: LocalInvokeOptions<never, never, never>) => Promise<R>
        : (options: LocalInvokeOptions<never, InferSchema<B>, never>) => Promise<R>
      : keyof B extends never
        ? (options?: LocalInvokeOptions<InferSchema<Q>, never, never>) => Promise<R>
        : (options: LocalInvokeOptions<InferSchema<Q>, InferSchema<B>, never>) => Promise<R>
    : // Has path params - options is required with path
      keyof Q extends never
      ? keyof B extends never
        ? (options: LocalInvokeOptionsWithPath<never, never, P>) => Promise<R>
        : (options: LocalInvokeOptionsWithPath<never, InferSchema<B>, P>) => Promise<R>
      : keyof B extends never
        ? (options: LocalInvokeOptionsWithPath<InferSchema<Q>, never, P>) => Promise<R>
        : (options: LocalInvokeOptionsWithPath<InferSchema<Q>, InferSchema<B>, P>) => Promise<R>;

/** Nested routes without configure (used for nested routers). */
export type LocalRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer Routes>
    ? LocalRouterClientRoutes<Routes>
    : T[K] extends RouteDefinition<infer P, infer Q, infer B, infer R, infer _Ext>
      ? LocalRouteClient<P, Q, B, R>
      : never;
};

/** Top-level local client type for router (configure only at top level). */
export type LocalRouterClient<T extends RouterRoutes> = {
  configure(config: LocalClientConfig): void;
} & LocalRouterClientRoutes<T>;

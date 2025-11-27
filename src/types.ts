/**
 * @fileoverview Core type definitions for the routing library.
 *
 * Contains all type definitions used across modules.
 */

import type { SchemaDefinition, InferSchema } from './schema.js';
import type { Middleware } from './middleware.js';

/** Standard HTTP methods. */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/** Typed parameters passed to route handlers. */
export interface TypedParams<Q, B> {
  query: Q;
  body: B;
}

/** Execution context for background tasks (Cloudflare Workers compatible). */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Handler function with typed query and body parameters (framework-agnostic). */
export type TypedHandler<Q, B> = (
  request: Request,
  params: TypedParams<Q, B>,
  env?: unknown,
  ctx?: ExecutionContext
) => Response | Promise<Response>;

/** Route definition with optional handler. */
export interface RouteDefinition<
  Q extends SchemaDefinition = {},
  B extends SchemaDefinition = {},
> {
  method: Method;
  path: string;
  query?: Q;
  body?: B;
  description?: string;
  handler?: TypedHandler<InferSchema<Q>, InferSchema<B>>;
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
export interface HttpFetchOptions<Q, B> {
  query?: Q;
  body?: B;
  headers?: HeadersInit;
}

/** HTTP client method for a single route based on query and body types. */
export type HttpRouteClient<Q extends SchemaDefinition, B extends SchemaDefinition> =
  keyof Q extends never
    ? keyof B extends never
      ? (options?: HttpFetchOptions<never, never>) => Promise<unknown>
      : (options: HttpFetchOptions<never, InferSchema<B>>) => Promise<unknown>
    : keyof B extends never
      ? (options?: HttpFetchOptions<InferSchema<Q>, never>) => Promise<unknown>
      : (options: HttpFetchOptions<InferSchema<Q>, InferSchema<B>>) => Promise<unknown>;

/** Nested routes without configure (used for nested routers). */
export type HttpRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer R>
    ? HttpRouterClientRoutes<R>
    : T[K] extends RouteDefinition<infer Q, infer B>
      ? HttpRouteClient<Q, B>
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
export interface LocalInvokeOptions<Q, B> {
  query?: Q;
  body?: B;
  env?: unknown;
  ctx?: ExecutionContext;
}

/** Local client method for a single route based on query and body types. */
export type LocalRouteClient<Q extends SchemaDefinition, B extends SchemaDefinition> =
  keyof Q extends never
    ? keyof B extends never
      ? (options?: LocalInvokeOptions<never, never>) => Promise<unknown>
      : (options: LocalInvokeOptions<never, InferSchema<B>>) => Promise<unknown>
    : keyof B extends never
      ? (options?: LocalInvokeOptions<InferSchema<Q>, never>) => Promise<unknown>
      : (options: LocalInvokeOptions<InferSchema<Q>, InferSchema<B>>) => Promise<unknown>;

/** Nested routes without configure (used for nested routers). */
export type LocalRouterClientRoutes<T extends RouterRoutes> = {
  [K in keyof T]: T[K] extends Router<infer R>
    ? LocalRouterClientRoutes<R>
    : T[K] extends RouteDefinition<infer Q, infer B>
      ? LocalRouteClient<Q, B>
      : never;
};

/** Top-level local client type for router (configure only at top level). */
export type LocalRouterClient<T extends RouterRoutes> = {
  configure(config: LocalClientConfig): void;
} & LocalRouterClientRoutes<T>;

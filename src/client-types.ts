import type { InferSchema } from './schema.js';
import type { CollectPathParams, RouteDefinition, Router, RouterRoutes } from './types.js';

// =============================================================================
// Shared Utility Types
// =============================================================================

/** HTTP method names as defined in routes (lowercase). */
export type LowercaseMethods = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Map lowercase method to $-prefixed version. */
export type PrefixedMethod<T extends LowercaseMethods> = T extends 'get'
  ? '$get'
  : T extends 'post'
    ? '$post'
    : T extends 'put'
      ? '$put'
      : T extends 'patch'
        ? '$patch'
        : T extends 'delete'
          ? '$delete'
          : never;

/** Extract return type from a handler. */
export type ExtractReturn<T> = T extends (...args: never[]) => infer R
  ? R extends Promise<infer U>
    ? U
    : R
  : unknown;

/** Detects if a type is `any`. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** Checks if a schema type should require a property. */
export type RequiresProperty<T> =
  IsAny<T> extends true ? false : keyof T extends never ? false : true;

/** Safely infer schema, returning {} for any, empty, or non-schema types. */
export type SafeInferSchema<T> =
  IsAny<T> extends true
    ? {}
    : keyof T extends never
      ? {}
      : T extends import('./schema.js').SchemaDefinition
        ? InferSchema<T>
        : {};

/** Check if router tree contains any $param properties. */
export type HasParams<Path extends string[]> = Path extends [
  infer Head,
  ...infer Rest extends string[],
]
  ? Head extends `$${string}`
    ? true
    : HasParams<Rest>
  : false;

/** Extract the MethodEntry part from a union type. */
export type ExtractMethod<T> =
  T extends RouteDefinition<infer _Q, infer _B, infer _R, infer _P, infer _Ctx>
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : never;

/** Remove string/number index signatures from a type. */
export type RemoveIndex<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** Header value that can be static or dynamic. */
export type HeaderValue =
  | string
  | (() => string | null | undefined | Promise<string | null | undefined>);

// =============================================================================
// Generic Client Types
// =============================================================================

/** Base options for any request. */
export interface BaseRequestOptions {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** Full request options including client-specific extras. */
export type RequestOptions<Extra> = BaseRequestOptions & Extra;

/** Build options type based on whether path params are needed. */
export type BuildOptions<Path extends string[], Q, B, Extra> = HasParams<Path> extends true
  ? { path: CollectPathParams<Path> } & (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) &
      Extra
  : (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) &
      Extra;

/** Client type for a method entry (route or bare function). */
export type MethodClient<T, Extra, Path extends string[] = []> = T extends RouteDefinition<
  infer Q,
  infer B,
  infer R,
  infer _P,
  infer _Ctx
>
  ? (options?: BuildOptions<Path, SafeInferSchema<Q>, SafeInferSchema<B>, Extra>) => Promise<R>
  : T extends (...args: never[]) => unknown
    ? (options?: BuildOptions<Path, {}, {}, Extra>) => Promise<ExtractReturn<T>>
    : never;

/** Helper to extract return type for implicit GET calls. */
export type ImplicitGetCall<
  T extends RouterRoutes,
  Extra,
  Path extends string[] = [],
> = 'get' extends keyof T
  ? ExtractMethod<T['get']> extends RouteDefinition<
      infer _Q,
      infer _B,
      infer R,
      infer _P,
      infer _Ctx
    >
    ? HasParams<Path> extends true
      ? (
          options: { path: CollectPathParams<Path> } & {
            query?: Record<string, unknown>;
          } & Extra,
        ) => Promise<R>
      : (options?: RequestOptions<Extra>) => Promise<R>
    : ExtractMethod<T['get']> extends (...args: never[]) => unknown
      ? HasParams<Path> extends true
        ? (
            options: { path: CollectPathParams<Path> } & {
              query?: Record<string, unknown>;
            } & Extra,
          ) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
        : (options?: RequestOptions<Extra>) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
      : (options?: RequestOptions<Extra>) => Promise<unknown>
  : (options?: RequestOptions<Extra>) => Promise<unknown>;

/**
 * Builds a URL string from the route path without executing a request.
 *
 * Path params are required when the path contains `$param` segments. Query
 * params are always optional and untyped, since `$url` is method-agnostic.
 */
export type UrlMethod<Path extends string[]> =
  HasParams<Path> extends true
    ? (options: { path: CollectPathParams<Path>; query?: Record<string, unknown> }) => string
    : (options?: { query?: Record<string, unknown> }) => string;

/** Client type for a router. */
export type RouterClient<T extends RouterRoutes, Extra, Path extends string[] = []> = {
  // Non-executing URL builder, available on every path node.
  $url: UrlMethod<Path>;
} & {
  // Method handlers become $-prefixed callable methods ($get, $post, etc.).
  [K in keyof RemoveIndex<T> as K extends LowercaseMethods
    ? PrefixedMethod<K>
    : never]: MethodClient<ExtractMethod<T[K]>, Extra, Path>;
} & {
  // ALL keys (including lowercase method names) become navigation paths.
  [K in keyof RemoveIndex<T>]: IsAny<T[K]> extends true
    ? never
    : Extract<T[K], Router<RouterRoutes>> extends infer R
      ? R extends Router<infer Routes>
        ? RouterClient<Routes, Extra, [...Path, K & string]> &
            ImplicitGetCall<Routes, Extra, [...Path, K & string]>
        : never
      : never;
} & ImplicitGetCall<T, Extra, Path>;

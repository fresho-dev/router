import type { InferSchema } from './schema.js';
import type { RouteDefinition, Router, RouterRoutes } from './types.js';

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
export type ExtractReturn<T> = T extends (...args: unknown[]) => infer R
  ? R extends Promise<infer U>
    ? U
    : R
  : unknown;

/** Detects if a type is `any`. */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/** Checks if a schema type should require a property. */
export type RequiresProperty<T> =
  IsAny<T> extends true ? false : keyof T extends never ? false : true;

/** Safely infer schema, returning {} for any or non-schema types. */
export type SafeInferSchema<T> =
  IsAny<T> extends true
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtractMethod<T> = Extract<
  T,
  RouteDefinition<any, any, any, any, any> | ((...args: unknown[]) => unknown)
>;

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
export type BuildOptions<HasPathParams extends boolean, Q, B, Extra> = HasPathParams extends true
  ? { path: Record<string, string> } & (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) &
      Extra
  : (RequiresProperty<Q> extends true ? { query?: Q } : {}) &
      (RequiresProperty<B> extends true ? { body: B } : {}) &
      Extra;

/** Client type for a method entry (route or bare function). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MethodClient<
  T,
  Extra,
  HasPathParams extends boolean = false,
> = T extends RouteDefinition<infer Q, infer B, infer R, any, any>
  ? (
      options?: BuildOptions<HasPathParams, SafeInferSchema<Q>, SafeInferSchema<B>, Extra>,
    ) => Promise<R>
  : T extends (...args: unknown[]) => unknown
    ? (options?: BuildOptions<HasPathParams, {}, {}, Extra>) => Promise<ExtractReturn<T>>
    : never;

/** Helper to extract return type for implicit GET calls. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ImplicitGetCall<
  T extends RouterRoutes,
  Extra,
  Path extends string[] = [],
> = 'get' extends keyof T
  ? ExtractMethod<T['get']> extends RouteDefinition<infer _Q, infer _B, infer R, any, any>
    ? HasParams<Path> extends true
      ? (
          options: { path: Record<string, string> } & { query?: Record<string, unknown> } & Extra,
        ) => Promise<R>
      : (options?: RequestOptions<Extra>) => Promise<R>
    : ExtractMethod<T['get']> extends (...args: unknown[]) => unknown
      ? HasParams<Path> extends true
        ? (
            options: { path: Record<string, string> } & { query?: Record<string, unknown> } & Extra,
          ) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
        : (options?: RequestOptions<Extra>) => Promise<ExtractReturn<ExtractMethod<T['get']>>>
      : (options?: RequestOptions<Extra>) => Promise<unknown>
  : (options?: RequestOptions<Extra>) => Promise<unknown>;

/** Client type for a router. */
export type RouterClient<T extends RouterRoutes, Extra, Path extends string[] = []> = {
  // Method handlers become $-prefixed callable methods ($get, $post, etc.).
  [K in keyof RemoveIndex<T> as K extends LowercaseMethods
    ? PrefixedMethod<K>
    : never]: ExtractMethod<T[K]> extends infer M
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      M extends RouteDefinition<any, any, any, any, any> | ((...args: unknown[]) => unknown)
      ? MethodClient<M, Extra, HasParams<Path>>
      : never
    : never;
} & {
  // ALL keys (including lowercase method names) become navigation paths.
  [K in keyof RemoveIndex<T>]: IsAny<T[K]> extends true
    ? never
    : Extract<T[K], Router<any>> extends infer R
      ? R extends Router<infer Routes>
        ? RouterClient<Routes, Extra, [...Path, K & string]> &
            ImplicitGetCall<Routes, Extra, [...Path, K & string]>
        : never
      : never;
} & ImplicitGetCall<T, Extra, Path>;

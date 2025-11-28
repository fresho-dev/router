/**
 * @fileoverview Framework-agnostic type-safe routing library.
 *
 * Provides utilities for defining routes with typed query/body schemas,
 * composing routers with nested paths, and generating typed clients.
 */

// Schema types and compilation.
export {
  type SchemaType,
  type SchemaDefinition,
  type SchemaTypeMap,
  type InferSchema,
  type ValidationResult,
  type CompiledSchema,
  compileSchema,
} from './schema.js';

// Core type definitions.
export {
  type Method,
  type ExtractPathParams,
  type TypedParams,
  type ExecutionContext,
  type Context,
  type TypedResponse,
  type TypedHandler,
  type RouteDefinition,
  type BaseRoute,
  type RouterEntry,
  type RouterRoutes,
  type Router,
  isRouter,
  isRoute,
} from './types.js';

// HTTP client types.
export {
  type HttpClientConfig,
  type HttpFetchOptions,
  type HttpRouteClient,
  type HttpRouterClientRoutes,
  type HttpRouterClient,
} from './types.js';

// Local client types.
export {
  type LocalClientConfig,
  type LocalInvokeOptions,
  type LocalRouteClient,
  type LocalRouterClientRoutes,
  type LocalRouterClient,
} from './types.js';

// Core functions.
export { route, router } from './core.js';

// Request handler.
export { createHandler, type FetchHandler } from './handler.js';

// Documentation generation.
export { generateDocs } from './docs.js';

// Middleware support.
export type { Middleware, MiddlewareContext, MiddlewareNext } from './middleware.js';
export { runMiddleware, compose, forMethods, forPaths, skipPaths } from './middleware.js';

// Re-export all middleware from the middleware module
export * from './middleware/index.js';

// Streaming utilities.
export { type SSEOptions, type SSEMessage, sseResponse, streamJsonLines } from './streaming.js';

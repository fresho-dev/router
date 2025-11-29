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
  type ExecutionContext,
  type Context,
  type TypedResponse,
  type TypedHandler,
  type RouteDefinition,
  type BaseRoute,
  type RouterEntry,
  type RouterRoutes,
  type Router,
  type FetchHandler,
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
export { createHttpClient } from './http-client.js';
export { createLocalClient } from './local-client.js';

// Documentation generation.
export { generateDocs } from './docs.js';

// Middleware types and utilities (implementations available via 'typed-routes/middleware').
export type { Middleware, MiddlewareContext, MiddlewareNext } from './middleware.js';
export { runMiddleware } from './middleware.js';

// Streaming utilities.
export { type SSEOptions, type SSEMessage, sseResponse, streamJsonLines } from './streaming.js';

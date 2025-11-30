/**
 * @fileoverview typed-routes - Framework-agnostic type-safe routing library.
 *
 * A zero-dependency routing library that provides end-to-end type safety from
 * route definition to client consumption. Works with Cloudflare Workers, Deno,
 * Bun, Node.js, and any fetch-compatible runtime.
 *
 * ## Core Concepts
 *
 * - **Routes** - Define HTTP endpoints with typed path params, query, body, and response
 * - **Routers** - Compose routes into hierarchical APIs with shared middleware
 * - **Clients** - Auto-generated typed HTTP and local clients from router definitions
 *
 * ## Quick Start
 *
 * ```typescript
 * import { route, router, createHttpClient } from 'typed-routes';
 *
 * // Define routes with full type inference
 * const api = router('/api', {
 *   users: router('/users', {
 *     list: route({ method: 'get', path: '', handler: async () => [] }),
 *     get: route({
 *       method: 'get',
 *       path: '/:id',
 *       handler: async (c) => ({ id: c.path.id }),
 *     }),
 *     create: route({
 *       method: 'post',
 *       path: '',
 *       body: { name: 'string', email: 'string' },
 *       handler: async (c) => ({ id: '1', ...c.body }),
 *     }),
 *   }),
 * });
 *
 * // Server: export fetch handler
 * export default { fetch: api.handler() };
 *
 * // Client: fully typed API calls
 * const client = createHttpClient(api);
 * client.configure({ baseUrl: 'https://api.example.com' });
 *
 * const users = await client.users.list();
 * const user = await client.users.get({ path: { id: '123' } });
 * ```
 *
 * ## Exports
 *
 * - {@link route} - Define individual routes
 * - {@link router} - Compose routes into routers
 * - {@link createHttpClient} - Create typed HTTP client
 * - {@link createLocalClient} - Create typed local client (no HTTP)
 * - {@link sseResponse} - Server-Sent Events streaming
 * - {@link streamJsonLines} - NDJSON streaming
 *
 * For authentication middleware, import from `typed-routes/middleware`:
 * - `jwtAuth` - JWT authentication middleware
 * - `jwtSign` - Sign JWT tokens
 * - `jwtVerify` - Verify JWT tokens
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

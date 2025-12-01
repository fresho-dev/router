/**
 * @fileoverview typed-routes - Framework-agnostic type-safe routing library.
 *
 * A zero-dependency routing library that provides end-to-end type safety from
 * route definition to client consumption. Works with Cloudflare Workers, Deno,
 * Bun, Node.js, and any fetch-compatible runtime.
 *
 * ## Core Concepts
 *
 * - **Routes** - Define HTTP endpoints with typed query, body, and response
 * - **Routers** - Compose routes into hierarchical APIs with shared middleware
 * - **Clients** - Auto-generated typed HTTP and local clients from router definitions
 *
 * ## Quick Start
 *
 * ```typescript
 * // === Server (server/api.ts) ===
 * import { route, router } from 'typed-routes';
 *
 * export const api = router({
 *   health: router({
 *     get: async () => ({ status: 'ok' }),
 *   }),
 *
 *   users: router({
 *     get: route({
 *       query: { limit: 'number?' },
 *       handler: async (c) => db.users.list(c.query.limit),
 *     }),
 *     post: route({
 *       body: { name: 'string', email: 'string' },
 *       handler: async (c) => db.users.create(c.body),
 *     }),
 *     $id: router({
 *       get: async (c) => db.users.get(c.path.id),
 *     }),
 *   }),
 * });
 *
 * export default { fetch: api.handler() };
 *
 * // === Client ===
 * import { createHttpClient } from 'typed-routes';
 * import type { api } from './api';  // Type-only import!
 *
 * const client = createHttpClient<typeof api>({ baseUrl: 'https://api.example.com' });
 *
 * // GET routes - callable directly or with .get()
 * await client.health();
 * const users = await client.users();
 * const user = await client.users.$id({ path: { id: '123' } });
 *
 * // Non-GET routes - use explicit method
 * await client.users.post({ body: { name: 'Alice', email: 'alice@example.com' } });
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
  type CollectPathParams,
  type ExecutionContext,
  type Context,
  type TypedResponse,
  type TypedHandler,
  type RouteDefinition,
  type MethodEntry,
  type RouterRoutes,
  type Router,
  type FetchHandler,
  isRouter,
  isRoute,
  isFunction,
} from './types.js';

// HTTP client types.
export {
  type HttpClientConfig,
  type HttpRequestOptions,
  type HttpClient,
} from './http-client.js';

// Local client types.
export {
  type LocalClientConfig,
  type LocalRequestOptions,
  type LocalClient,
} from './local-client.js';

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

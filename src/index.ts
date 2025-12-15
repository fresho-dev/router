/**
 * @fileoverview @fresho/router - Framework-agnostic type-safe routing library.
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
 * import { route, router } from '@fresho/router';
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
 * import { createHttpClient } from '@fresho/router';
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
 * await client.users.$post({ body: { name: 'Alice', email: 'alice@example.com' } });
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
 * For authentication middleware, import from `@fresho/router/middleware`:
 * - `jwtAuth` - JWT authentication middleware
 * - `jwtSign` - Sign JWT tokens
 * - `jwtVerify` - Verify JWT tokens
 */

// Core functions.
export { route, router } from './core.js';
// Documentation generation.
export { generateDocs } from './docs.js';
// HTTP client types.
export {
  createHttpClient,
  type HttpClient,
  type HttpClientConfig,
  type HttpRequestOptions,
} from './http-client.js';
// Local client types.
export {
  createLocalClient,
  type LocalClient,
  type LocalClientConfig,
  type LocalRequestOptions,
} from './local-client.js';
// Middleware types and utilities (implementations available via '@fresho/router/middleware').
export type { Middleware, MiddlewareContext, MiddlewareNext } from './middleware.js';
export { runMiddleware } from './middleware.js';
// Schema types and compilation.
export {
  type CompiledSchema,
  compileSchema,
  type InferSchema,
  type SchemaDefinition,
  type SchemaType,
  type SchemaTypeMap,
  type ValidationResult,
} from './schema.js';
// Streaming utilities.
export { type SSEMessage, type SSEOptions, sseResponse, streamJsonLines } from './streaming.js';
// Core type definitions.
export {
  type CollectPathParams,
  type Context,
  type ExecutionContext,
  type FetchHandler,
  isFunction,
  isRoute,
  isRouter,
  type Method,
  type MethodEntry,
  type RouteDefinition,
  type Router,
  type RouterBrand,
  type RouterRoutes,
  type TypedHandler,
  type TypedResponse,
} from './types.js';

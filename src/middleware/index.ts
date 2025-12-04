/**
 * @fileoverview Middleware implementations for typed-routes.
 *
 * Provides ready-to-use middleware for common web application needs:
 * - **CORS** - Cross-Origin Resource Sharing with flexible origin matching
 * - **Auth** - JWT, Basic, and Bearer token authentication
 * - **Error Handling** - Catch and format errors with optional logging
 * - **Logging** - Request/response logging with customizable format
 * - **Rate Limiting** - Protect routes from abuse with configurable limits
 * - **Request ID** - Add unique identifiers to requests for tracing
 * - **Timeout** - Abort requests that take too long
 * - **Content Type** - Validate request content types
 *
 * Import via: `import { cors, jwtAuth, ... } from 'typed-routes/middleware';`
 *
 * @example
 * ```typescript
 * import { router } from 'typed-routes';
 * import { cors, jwtAuth, errorHandler, rateLimit } from 'typed-routes/middleware';
 *
 * const api = router('/api', routes,
 *   cors({ origin: 'https://example.com' }),
 *   errorHandler({ expose: false }),
 *   rateLimit({ max: 100, windowMs: 60_000 }),
 *   jwtAuth({
 *     secret: process.env.JWT_SECRET,
 *     claims: (p) => ({ user: { id: p.sub } }),
 *   })
 * );
 * ```
 */

// Compose utility
export { compose } from '../middleware.js';
// Authentication middleware
export type {
  BasicAuthOptions,
  BearerAuthOptions,
  JwtAlgorithm,
  JwtAuthOptions,
  JwtPayload,
  SignJwtOptions,
  VerifyJwtOptions,
} from './auth.js';
export { basicAuth, bearerAuth, jwtAuth, jwtSign, jwtVerify } from './auth.js';
// Common middleware utilities
export type {
  ContentTypeOptions,
  ErrorHandlerOptions,
  LoggerOptions,
  LogInfo,
  RateLimitOptions,
  RateLimitStore,
  RequestIdOptions,
  TimeoutOptions,
} from './common.js';
export {
  contentType,
  errorHandler,
  HttpError,
  logger,
  MemoryRateLimitStore,
  rateLimit,
  requestId,
  timeout,
} from './common.js';
// CORS middleware
export type { CorsOptions } from './cors.js';
export { cors } from './cors.js';

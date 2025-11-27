/**
 * @fileoverview Middleware exports for typed-routes.
 *
 * Re-exports all middleware utilities and implementations.
 */

// Core middleware utilities
export type { MiddlewareContext, MiddlewareNext, Middleware } from '../middleware.js';
export { runMiddleware, compose, forMethods, forPaths, skipPaths } from '../middleware.js';

// CORS middleware
export type { CorsOptions } from './cors.js';
export { cors } from './cors.js';

// Authentication middleware
export type {
  BasicAuthOptions,
  JwtAuthOptions,
  JwtPayload,
  BearerAuthOptions,
} from './auth.js';
export { basicAuth, jwtAuth, bearerAuth } from './auth.js';

// Common middleware utilities
export type {
  ErrorHandlerOptions,
  LoggerOptions,
  LogInfo,
  RateLimitOptions,
  RateLimitStore,
  RequestIdOptions,
  TimeoutOptions,
  ContentTypeOptions,
} from './common.js';
export {
  errorHandler,
  logger,
  rateLimit,
  MemoryRateLimitStore,
  requestId,
  timeout,
  contentType,
} from './common.js';
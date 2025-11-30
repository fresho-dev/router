/**
 * @fileoverview Middleware implementations for typed-routes.
 *
 * Import via: import { cors, errorHandler } from 'typed-routes/middleware';
 */

// Compose utility
export { compose } from '../middleware.js';

// CORS middleware
export type { CorsOptions } from './cors.js';
export { cors } from './cors.js';

// Authentication middleware
export type {
  BasicAuthOptions,
  JwtAuthOptions,
  JwtPayload,
  SignJwtOptions,
  BearerAuthOptions,
} from './auth.js';
export { basicAuth, jwtAuth, jwtSign, bearerAuth } from './auth.js';

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
  HttpError,
  errorHandler,
  logger,
  rateLimit,
  MemoryRateLimitStore,
  requestId,
  timeout,
  contentType,
} from './common.js';
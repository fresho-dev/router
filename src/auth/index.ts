/**
 * @fileoverview Authentication utilities for @fresho/router.
 *
 * This module provides core authentication primitives that can be used
 * independently or with the middleware layer. For middleware integration,
 * see `@fresho/router/middleware`.
 *
 * ## Available Modules
 *
 * - **JWT**: Token signing and verification using Web Crypto API
 * - **Basic**: HTTP Basic authentication parsing and encoding
 * - **OAuth**: OAuth 2.0 state management and token exchange
 *
 * @example
 * ```typescript
 * import { jwtSign, jwtVerify, parseBasicAuth, encodeOAuthState } from '@fresho/router/auth';
 *
 * // JWT operations
 * const token = await jwtSign({ uid: 'user-123' }, SECRET, { expiresIn: '1h' });
 * const payload = await jwtVerify(token, SECRET);
 *
 * // Basic auth parsing
 * const creds = parseBasicAuth(request.headers.get('Authorization'));
 *
 * // OAuth state management
 * const state = await encodeOAuthState({ uid: 'user-123' }, STATE_SECRET);
 * ```
 */

// Basic auth utilities
export type { BasicCredentials } from './basic.js';
export { encodeBasicAuth, extractBasicAuthToken, parseBasicAuth } from './basic.js';

// JWT utilities
export type {
  JwtAlgorithm,
  JwtPayload,
  JwtSecret,
  SignJwtOptions,
  VerifyJwtOptions,
} from './jwt.js';
export { jwtSign, jwtVerify } from './jwt.js';

// OAuth utilities
export type {
  AuthorizationUrlOptions,
  ExchangeCodeOptions,
  OAuthProvider,
  OAuthTokenResponse,
  RevokeTokenOptions,
  TokenAuthMethod,
} from './oauth.js';
export {
  buildAuthorizationUrl,
  decodeOAuthState,
  encodeOAuthState,
  exchangeCode,
  OAUTH_PROVIDERS,
  refreshAccessToken,
  revokeToken,
} from './oauth.js';

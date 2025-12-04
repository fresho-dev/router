/**
 * @fileoverview Authentication middleware for typed-routes.
 *
 * Provides Basic HTTP and JWT authentication middleware.
 */

import type { Middleware, MiddlewareContext } from '../middleware.js';

// =============================================================================
// Basic Auth
// =============================================================================

/** Basic authentication middleware configuration. */
export interface BasicAuthOptions {
  /** Realm name for the authentication challenge. */
  realm?: string;
  /** Function to validate credentials. Returns claims to merge into context, or null to reject. */
  verify: (
    username: string,
    password: string,
    context: MiddlewareContext,
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * Creates a Basic HTTP authentication middleware.
 *
 * @example
 * ```typescript
 * const adminRouter = router('/admin', routes,
 *   basicAuth({
 *     verify: async (username, password) => {
 *       if (username === 'admin' && password === 'secret') {
 *         return { user: { name: username } };
 *       }
 *       return null;
 *     }
 *   })
 * );
 * ```
 */
export function basicAuth(options: BasicAuthOptions): Middleware {
  const realm = options.realm || 'Secure Area';

  return async (context, next) => {
    const { request } = context;

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Basic ')) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
        },
      });
    }

    try {
      const credentials = atob(authHeader.slice(6));
      const colonIndex = credentials.indexOf(':');
      if (colonIndex === -1) {
        throw new Error('Invalid credentials format');
      }
      const username = credentials.substring(0, colonIndex);
      const password = credentials.substring(colonIndex + 1);

      const claims = await options.verify(username, password, context);
      if (claims === null) {
        return new Response('Invalid credentials', {
          status: 401,
          headers: {
            'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
          },
        });
      }

      Object.assign(context, claims);
      return next();
    } catch (_error) {
      return new Response('Invalid credentials', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
        },
      });
    }
  };
}

// =============================================================================
// JWT Auth
// =============================================================================

/** JWT payload type. */
export interface JwtPayload {
  /** Subject (user ID). */
  sub?: string;
  /** Issued at timestamp. */
  iat?: number;
  /** Expiration timestamp. */
  exp?: number;
  /** Not before timestamp. */
  nbf?: number;
  /** Issuer. */
  iss?: string;
  /** Audience. */
  aud?: string | string[];
  /** Additional claims. */
  [key: string]: unknown;
}

/** Supported HMAC algorithms for JWT signing/verification. */
export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512';

/** Maps JWT algorithm names to Web Crypto hash names. */
const ALGORITHM_MAP: Record<JwtAlgorithm, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

/** Options for signing a JWT. */
export interface SignJwtOptions {
  /** Signing algorithm (default: 'HS256'). */
  algorithm?: JwtAlgorithm;
  /** Expiration time (e.g., '1h', '7d', '30m', or seconds as number). */
  expiresIn?: string | number;
  /** Not before time (e.g., '5m', or seconds as number). */
  notBefore?: string | number;
  /** Issuer claim. */
  issuer?: string;
  /** Audience claim. */
  audience?: string | string[];
  /** Subject claim. */
  subject?: string;
  /** Custom issued-at timestamp (defaults to now). */
  issuedAt?: number | Date;
}

/** JWT secret value. */
type JwtSecret = string | ArrayBuffer | CryptoKey;

/** Options for verifying a JWT. */
export interface VerifyJwtOptions {
  /** Allowed algorithms (default: ['HS256']). */
  algorithms?: JwtAlgorithm[];
}

/** JWT authentication middleware configuration. */
export interface JwtAuthOptions<Ctx = {}> {
  /** Secret key or function to get the secret from context. */
  secret: JwtSecret | ((context: MiddlewareContext<Ctx>) => JwtSecret);
  /**
   * Map JWT payload to context properties. Return null to reject the token.
   * The returned object is merged into the middleware context.
   */
  claims: (payload: JwtPayload) => Record<string, unknown> | null;
  /** Allowed algorithms (default: ['HS256']). */
  algorithms?: JwtAlgorithm[];
  /** Function to extract token from request (default: Authorization header or 'token' cookie). */
  getToken?: (request: Request) => string | null;
}

/**
 * Verifies a JWT token using Web Crypto API.
 *
 * Uses only Web Crypto API, compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @param token - The JWT token string to verify
 * @param secret - The secret used to sign the token (string, ArrayBuffer, or CryptoKey)
 * @param options - Optional verification options
 * @returns The decoded JWT payload
 * @throws Error if the token is invalid, expired, or not yet valid
 *
 * @example
 * ```typescript
 * import { jwtVerify } from 'typed-routes/middleware';
 *
 * try {
 *   const payload = await jwtVerify(token, 'your-secret-key');
 *   console.log(payload.sub); // user ID
 * } catch (error) {
 *   console.error('Invalid token:', error.message);
 * }
 *
 * // With specific algorithms
 * const payload = await jwtVerify(token, secret, { algorithms: ['HS512'] });
 * ```
 */
export async function jwtVerify(
  token: string,
  secret: string | ArrayBuffer | CryptoKey,
  options: VerifyJwtOptions = {},
): Promise<JwtPayload> {
  const algorithms = options.algorithms || ['HS256'];

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header.
  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
  if (!algorithms.includes(header.alg)) {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Get the hash algorithm for the JWT algorithm.
  const hashAlg = ALGORITHM_MAP[header.alg as JwtAlgorithm];
  if (!hashAlg) {
    throw new Error(`Unknown algorithm: ${header.alg}`);
  }

  // Decode payload.
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

  // Verify signature using Web Crypto API.
  const data = `${headerB64}.${payloadB64}`;
  const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );

  let key: CryptoKey;
  if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: hashAlg }, false, [
      'verify',
    ]);
  }

  const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(data));

  if (!valid) {
    throw new Error('Invalid signature');
  }

  // Check expiration.
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  // Check not before.
  if (payload.nbf && payload.nbf > Date.now() / 1000) {
    throw new Error('Token not yet valid');
  }

  return payload as JwtPayload;
}

/**
 * Parses a duration string (e.g., '1h', '7d', '30m') to seconds.
 */
function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration;

  const match = duration.match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use formats like '1h', '7d', '30m', '60s'.`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    case 'w':
      return value * 60 * 60 * 24 * 7;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Base64url encodes a string or Uint8Array.
 */
function base64urlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Signs a JWT token using Web Crypto API.
 *
 * Uses only Web Crypto API, compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @param payload - The JWT payload (custom claims)
 * @param secret - The signing secret (string, ArrayBuffer, or CryptoKey)
 * @param options - Optional signing options (algorithm, expiresIn, issuer, etc.)
 * @returns The signed JWT token string
 *
 * @example
 * ```typescript
 * // Basic usage (HS256 by default)
 * const token = await jwtSign(
 *   { uid: 'user-123', role: 'admin' },
 *   'your-secret-key',
 *   { expiresIn: '1h' }
 * );
 *
 * // With HS512 algorithm
 * const token = await jwtSign(
 *   { uid: 'user-123' },
 *   process.env.JWT_SECRET,
 *   { algorithm: 'HS512', expiresIn: '7d' }
 * );
 * ```
 */
export async function jwtSign(
  payload: Record<string, unknown>,
  secret: JwtSecret,
  options: SignJwtOptions = {},
): Promise<string> {
  const algorithm = options.algorithm || 'HS256';
  const hashAlg = ALGORITHM_MAP[algorithm];

  const now = options.issuedAt
    ? options.issuedAt instanceof Date
      ? Math.floor(options.issuedAt.getTime() / 1000)
      : options.issuedAt
    : Math.floor(Date.now() / 1000);

  // Build the final payload with registered claims.
  const finalPayload: JwtPayload = {
    ...payload,
    iat: now,
  };

  if (options.expiresIn !== undefined) {
    finalPayload.exp = now + parseDuration(options.expiresIn);
  }

  if (options.notBefore !== undefined) {
    finalPayload.nbf = now + parseDuration(options.notBefore);
  }

  if (options.issuer !== undefined) {
    finalPayload.iss = options.issuer;
  }

  if (options.audience !== undefined) {
    finalPayload.aud = options.audience;
  }

  if (options.subject !== undefined) {
    finalPayload.sub = options.subject;
  }

  // Create header.
  const header = { alg: algorithm, typ: 'JWT' };

  // Encode header and payload.
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(finalPayload));
  const data = `${headerB64}.${payloadB64}`;

  // Import key for signing.
  let key: CryptoKey;
  if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: hashAlg }, false, [
      'sign',
    ]);
  }

  // Sign the data.
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  const signatureB64 = base64urlEncode(new Uint8Array(signatureBuffer));

  return `${data}.${signatureB64}`;
}

/**
 * Creates a JWT authentication middleware.
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   env: { JWT_SECRET: string };
 *   user: { id: string; email: string };
 * }
 *
 * jwtAuth<AppContext>({
 *   secret: (ctx) => ctx.env.JWT_SECRET,  // ctx.env is typed
 *   claims: (payload) => ({
 *     user: { id: payload.sub, email: payload.email },
 *   }),
 * })
 *
 * // In your route handler:
 * route.ctx<AppContext>()({
 *   handler: async (c) => {
 *     return { email: c.user.email };  // Fully typed
 *   },
 * })
 * ```
 */
export function jwtAuth<Ctx = {}>(options: JwtAuthOptions<Ctx>): Middleware<Ctx> {
  const getToken =
    options.getToken ||
    ((req) => {
      const auth = req.headers.get('Authorization');
      if (auth?.startsWith('Bearer ')) {
        return auth.slice(7);
      }
      // Also check for token in cookie
      const cookie = req.headers.get('Cookie');
      if (cookie) {
        const match = cookie.match(/(?:^|;\s*)token=([^;]*)/);
        if (match) {
          return match[1];
        }
      }
      return null;
    });

  return async (context, next) => {
    const { request } = context;

    const token = getToken(request);
    if (!token) {
      return new Response('Missing token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    try {
      const secret =
        typeof options.secret === 'function' ? options.secret(context) : options.secret;

      const payload = await jwtVerify(token, secret, { algorithms: options.algorithms });

      // Map payload to context properties
      const claims = options.claims(payload);
      if (claims === null) {
        throw new Error('Token validation failed');
      }
      Object.assign(context, claims);

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      return new Response(message, {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer error="invalid_token", error_description="${message}"`,
        },
      });
    }
  };
}

// =============================================================================
// Bearer Token Auth (Simple)
// =============================================================================

/** Bearer token authentication options. */
export interface BearerAuthOptions {
  /** Function to validate the token. Returns claims to merge into context, or null to reject. */
  verify: (
    token: string,
    context: MiddlewareContext,
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * Creates a simple bearer token authentication middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes,
 *   bearerAuth({
 *     verify: async (token) => {
 *       if (token === process.env.API_TOKEN) {
 *         return { apiClient: 'trusted' };
 *       }
 *       return null;
 *     }
 *   })
 * );
 * ```
 */
export function bearerAuth(options: BearerAuthOptions): Middleware {
  return async (context, next) => {
    const { request } = context;

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Missing token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    const token = authHeader.slice(7);
    const claims = await options.verify(token, context);

    if (claims === null) {
      return new Response('Invalid token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
    }

    Object.assign(context, claims);
    return next();
  };
}

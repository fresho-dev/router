/**
 * @fileoverview Authentication middleware for typed-routes.
 *
 * Provides Basic HTTP and JWT authentication middleware.
 */

import type { Middleware, MiddlewareContext } from '../middleware.js';

/**
 * Checks if the request is from localhost.
 */
function isLocalhost(request: Request): boolean {
  const url = new URL(request.url);
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
}

// =============================================================================
// Basic Auth
// =============================================================================

/** Basic authentication middleware configuration. */
export interface BasicAuthOptions {
  /** Realm name for the authentication challenge. */
  realm?: string;
  /** Function to validate credentials. */
  validate: (
    username: string,
    password: string,
    context: MiddlewareContext
  ) => Promise<boolean> | boolean;
  /** Skip authentication for these paths. */
  skipPaths?: (string | RegExp)[];
  /** Skip authentication for localhost requests. */
  skipLocalhost?: boolean;
}

/**
 * Creates a Basic HTTP authentication middleware.
 *
 * @example
 * ```typescript
 * const adminRouter = router('/admin', routes, [
 *   basicAuth({
 *     validate: async (username, password) => {
 *       return username === 'admin' && password === 'secret';
 *     }
 *   })
 * ]);
 * ```
 */
export function basicAuth(options: BasicAuthOptions): Middleware {
  const realm = options.realm || 'Secure Area';

  return async (context, next) => {
    const { request } = context;

    // Skip auth for certain paths
    if (options.skipPaths) {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const shouldSkip = options.skipPaths.some(path => {
        if (typeof path === 'string') {
          return pathname.startsWith(path);
        }
        return path.test(pathname);
      });
      if (shouldSkip) {
        return next();
      }
    }

    // Skip for localhost in development
    if (options.skipLocalhost && isLocalhost(request)) {
      return next();
    }

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

      const isValid = await options.validate(username, password, context);
      if (!isValid) {
        return new Response('Invalid credentials', {
          status: 401,
          headers: {
            'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
          },
        });
      }

      // Add user to context for handler access
      context.user = username;
      return next();
    } catch (error) {
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

/** JWT authentication middleware configuration. */
export interface JwtAuthOptions {
  /** Secret key or function to get the secret. */
  secret: string | ArrayBuffer | CryptoKey | (() => Promise<string | ArrayBuffer | CryptoKey>);
  /** Allowed algorithms. */
  algorithms?: string[];
  /** Function to extract token from request. */
  getToken?: (request: Request) => string | null;
  /** Skip authentication for these paths. */
  skipPaths?: (string | RegExp)[];
  /** Validate additional claims. */
  validate?: (payload: JwtPayload, context: MiddlewareContext) => Promise<boolean> | boolean;
}

/**
 * Verifies a JWT token using Web Crypto API.
 */
async function verifyJwt(
  token: string,
  secret: string | ArrayBuffer | CryptoKey,
  algorithms: string[] = ['HS256']
): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header
  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
  if (!algorithms.includes(header.alg)) {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Decode payload
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

  // Verify signature using Web Crypto API
  const data = `${headerB64}.${payloadB64}`;
  const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  let key: CryptoKey;
  if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(data)
  );

  if (!valid) {
    throw new Error('Invalid signature');
  }

  // Check expiration
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  // Check not before
  if (payload.nbf && payload.nbf > Date.now() / 1000) {
    throw new Error('Token not yet valid');
  }

  return payload as JwtPayload;
}

/**
 * Creates a JWT authentication middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, [
 *   jwtAuth({
 *     secret: process.env.JWT_SECRET,
 *     skipPaths: ['/api/login']
 *   })
 * ]);
 * ```
 */
export function jwtAuth(options: JwtAuthOptions): Middleware {
  const getToken = options.getToken || ((req) => {
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

    // Skip auth for certain paths
    if (options.skipPaths) {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const shouldSkip = options.skipPaths.some(path => {
        if (typeof path === 'string') {
          return pathname.startsWith(path);
        }
        return path.test(pathname);
      });
      if (shouldSkip) {
        return next();
      }
    }

    const token = getToken(request);
    if (!token) {
      return new Response('Missing token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    try {
      const secret = typeof options.secret === 'function'
        ? await options.secret()
        : options.secret;

      const payload = await verifyJwt(token, secret, options.algorithms);

      // Additional validation if provided
      if (options.validate) {
        const isValid = await options.validate(payload, context);
        if (!isValid) {
          throw new Error('Token validation failed');
        }
      }

      // Add JWT payload to context
      context.jwt = payload;
      context.user = payload.sub;

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      return new Response(message, {
        status: 401,
        headers: { 'WWW-Authenticate': `Bearer error="invalid_token", error_description="${message}"` },
      });
    }
  };
}

// =============================================================================
// Bearer Token Auth (Simple)
// =============================================================================

/** Bearer token authentication options. */
export interface BearerAuthOptions {
  /** Function to validate the token. */
  validate: (token: string, context: MiddlewareContext) => Promise<boolean> | boolean;
  /** Skip authentication for these paths. */
  skipPaths?: (string | RegExp)[];
}

/**
 * Creates a simple bearer token authentication middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, [
 *   bearerAuth({
 *     validate: async (token) => {
 *       return token === process.env.API_TOKEN;
 *     }
 *   })
 * ]);
 * ```
 */
export function bearerAuth(options: BearerAuthOptions): Middleware {
  return async (context, next) => {
    const { request } = context;

    // Skip auth for certain paths
    if (options.skipPaths) {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const shouldSkip = options.skipPaths.some(path => {
        if (typeof path === 'string') {
          return pathname.startsWith(path);
        }
        return path.test(pathname);
      });
      if (shouldSkip) {
        return next();
      }
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response('Missing token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    const token = authHeader.slice(7);
    const isValid = await options.validate(token, context);

    if (!isValid) {
      return new Response('Invalid token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
    }

    context.token = token;
    return next();
  };
}
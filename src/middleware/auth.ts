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
    context: MiddlewareContext
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * Creates a Basic HTTP authentication middleware.
 *
 * @example
 * ```typescript
 * const adminRouter = router('/admin', routes, [
 *   basicAuth({
 *     verify: async (username, password) => {
 *       if (username === 'admin' && password === 'secret') {
 *         return { user: { name: username } };
 *       }
 *       return null;
 *     }
 *   })
 * ]);
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

/** JWT secret value. */
type JwtSecret = string | ArrayBuffer | CryptoKey;

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
  algorithms?: string[];
  /** Function to extract token from request (default: Authorization header or 'token' cookie). */
  getToken?: (request: Request) => string | null;
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

    const token = getToken(request);
    if (!token) {
      return new Response('Missing token', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    try {
      const secret = typeof options.secret === 'function'
        ? options.secret(context)
        : options.secret;

      const payload = await verifyJwt(token, secret, options.algorithms);

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
  /** Function to validate the token. Returns claims to merge into context, or null to reject. */
  verify: (token: string, context: MiddlewareContext) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

/**
 * Creates a simple bearer token authentication middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, [
 *   bearerAuth({
 *     verify: async (token) => {
 *       if (token === process.env.API_TOKEN) {
 *         return { apiClient: 'trusted' };
 *       }
 *       return null;
 *     }
 *   })
 * ]);
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
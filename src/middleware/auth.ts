/**
 * @fileoverview Authentication middleware for @fresho/router.
 *
 * Provides middleware wrappers for Basic HTTP, JWT, and Bearer token authentication.
 * The underlying authentication utilities are in `@fresho/router/auth`.
 */

import { parseBasicAuth } from '../auth/basic.js';
import { type JwtAlgorithm, type JwtPayload, type JwtSecret, jwtVerify } from '../auth/jwt.js';
import type { Middleware, MiddlewareContext } from '../middleware.js';

// Re-export types that middleware users need
export type {
  JwtAlgorithm,
  JwtPayload,
  JwtSecret,
  SignJwtOptions,
  VerifyJwtOptions,
} from '../auth/jwt.js';

// Re-export utilities that are commonly used alongside middleware
export { jwtSign, jwtVerify } from '../auth/jwt.js';

// =============================================================================
// Basic Auth Middleware
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

    const credentials = parseBasicAuth(request.headers.get('Authorization'));
    if (!credentials) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
        },
      });
    }

    try {
      const claims = await options.verify(credentials.username, credentials.password, context);
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
// JWT Auth Middleware
// =============================================================================

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
      // Also check for token in cookie.
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

      // Map payload to context properties.
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
// Bearer Token Auth Middleware (Simple)
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

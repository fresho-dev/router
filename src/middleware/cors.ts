/**
 * @fileoverview CORS middleware for @fresho/router.
 *
 * Provides Cross-Origin Resource Sharing support with configurable options.
 */

import type { Middleware } from '../middleware.js';

/** CORS middleware configuration options. */
export interface CorsOptions {
  /** Allowed origins. Can be string, array, regex, or function. */
  origin?: string | string[] | RegExp | ((origin: string) => boolean);
  /** Allowed HTTP methods. */
  methods?: string[];
  /** Allowed request headers. */
  allowedHeaders?: string[];
  /** Headers to expose to the browser. */
  exposedHeaders?: string[];
  /** Allow credentials (cookies, authorization headers). */
  credentials?: boolean;
  /** Max age for preflight cache (seconds). */
  maxAge?: number;
  /** Pass the CORS preflight response to the next handler. */
  preflightContinue?: boolean;
}

/**
 * Determines if an origin is allowed based on the configuration.
 */
function getAllowedOrigin(
  requestOrigin: string | null,
  configOrigin: CorsOptions['origin'],
): string {
  if (!requestOrigin) {
    return '*';
  }

  if (!configOrigin || configOrigin === '*') {
    return '*';
  }

  if (typeof configOrigin === 'string') {
    return configOrigin === requestOrigin ? configOrigin : 'false';
  }

  if (Array.isArray(configOrigin)) {
    return configOrigin.includes(requestOrigin) ? requestOrigin : 'false';
  }

  if (configOrigin instanceof RegExp) {
    return configOrigin.test(requestOrigin) ? requestOrigin : 'false';
  }

  if (typeof configOrigin === 'function') {
    return configOrigin(requestOrigin) ? requestOrigin : 'false';
  }

  return 'false';
}

/**
 * Creates a CORS middleware with the specified options.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, cors({ origin: 'https://example.com', credentials: true }));
 * ```
 */
export function cors(options: CorsOptions = {}): Middleware {
  const config: Required<CorsOptions> = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: [],
    credentials: false,
    maxAge: 86400,
    preflightContinue: false,
    ...options,
  };

  return async (context, next) => {
    const { request } = context;
    const requestOrigin = request.headers.get('Origin');
    const allowedOrigin = getAllowedOrigin(requestOrigin, config.origin);

    // Handle preflight request
    if (request.method === 'OPTIONS') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': config.methods.join(', '),
        Vary: 'Origin',
      };

      if (config.allowedHeaders.length > 0) {
        const requestHeaders = request.headers.get('Access-Control-Request-Headers');
        if (requestHeaders) {
          // Allow requested headers if they're in the allowed list
          const requested = requestHeaders.split(',').map((h) => h.trim().toLowerCase());
          const allowed = config.allowedHeaders.map((h) => h.toLowerCase());
          const toAllow = requested.filter((h) => allowed.includes(h));
          if (toAllow.length > 0) {
            headers['Access-Control-Allow-Headers'] = toAllow.join(', ');
          }
        } else {
          headers['Access-Control-Allow-Headers'] = config.allowedHeaders.join(', ');
        }
      }

      if (config.exposedHeaders.length > 0) {
        headers['Access-Control-Expose-Headers'] = config.exposedHeaders.join(', ');
      }

      if (config.credentials) {
        headers['Access-Control-Allow-Credentials'] = 'true';
      }

      if (config.maxAge) {
        headers['Access-Control-Max-Age'] = String(config.maxAge);
      }

      const response = new Response(null, {
        status: 204,
        headers,
      });

      if (config.preflightContinue) {
        // Continue to next middleware/handler even for preflight
        const nextResponse = await next();
        // Merge headers from next response
        const mergedHeaders = new Headers(nextResponse.headers);
        Object.entries(headers).forEach(([key, value]) => {
          mergedHeaders.set(key, value);
        });
        return new Response(nextResponse.body, {
          status: nextResponse.status,
          statusText: nextResponse.statusText,
          headers: mergedHeaders,
        });
      }

      return response;
    }

    // Handle actual request
    const response = await next();

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');

    if (config.credentials && allowedOrigin !== '*') {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (config.exposedHeaders.length > 0) {
      headers.set('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * @fileoverview Common middleware utilities for @fresho/router.
 *
 * Provides error handling, logging, rate limiting, and other utilities.
 */

import type { Middleware, MiddlewareContext } from '../middleware.js';

// =============================================================================
// Error Handler
// =============================================================================

/**
 * HTTP error with status code for use with errorHandler middleware.
 *
 * Throw this in route handlers to return a specific HTTP status code.
 * The errorHandler middleware will catch it and format the response.
 *
 * @example
 * ```typescript
 * import { HttpError } from '@fresho/router/middleware';
 *
 * const getUser = route({
 *   method: 'get',
 *   path: '/users/:id',
 *   handler: async (c) => {
 *     const user = await db.findUser(c.path.id);
 *     if (!user) throw new HttpError('User not found', 404);
 *     return user;
 *   },
 * });
 * ```
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Extracts HTTP status code from an error object.
 *
 * Supports errors with `status` or `statusCode` properties (common patterns
 * in frameworks like Express, Koa, Hono, and custom HTTP error classes).
 */
function getErrorStatus(error: unknown): number {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }
  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  return 500;
}

/** Error handler middleware configuration. */
export interface ErrorHandlerOptions {
  /** Custom error logger. */
  log?: (error: Error, context: MiddlewareContext) => void | Promise<void>;
  /** Expose error details in response (dangerous in production). */
  expose?: boolean;
  /** Custom error response formatter. */
  formatter?: (error: Error, context: MiddlewareContext) => Response | Promise<Response>;
}

/**
 * Creates an error handling middleware that catches and formats errors.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, errorHandler({ expose: false }));
 * ```
 */
export function errorHandler(options: ErrorHandlerOptions = {}): Middleware {
  return async (context, next) => {
    try {
      return await next();
    } catch (error) {
      const err = error as Error;

      // Log error if logger provided
      if (options.log) {
        await options.log(err, context);
      } else {
        console.error(`Error in ${context.request.method} ${context.request.url}:`, err);
      }

      // Use custom formatter if provided
      if (options.formatter) {
        return await options.formatter(err, context);
      }

      // Default error response
      const message = options.expose ? err.message : 'Internal Server Error';
      const status = getErrorStatus(error);

      const errorBody = {
        error: message,
        ...(options.expose && {
          stack: err.stack,
          name: err.name,
        }),
      };

      return new Response(JSON.stringify(errorBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

// =============================================================================
// Logger
// =============================================================================

/** Logger middleware configuration. */
export interface LoggerOptions {
  /** Custom logger function. */
  log?: (message: string) => void;
  /** Include request headers in log. */
  includeHeaders?: boolean;
  /** Include request body in log. */
  includeBody?: boolean;
  /** Custom log formatter. */
  formatter?: (info: LogInfo) => string;
}

/** Information logged for each request. */
export interface LogInfo {
  method: string;
  url: string;
  status: number;
  duration: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: Error;
}

/**
 * Creates a request/response logging middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, logger({ includeHeaders: true }));
 * ```
 */
export function logger(options: LoggerOptions = {}): Middleware {
  const log = options.log || console.log;

  return async (context, next) => {
    const { request } = context;
    const start = Date.now();
    const url = new URL(request.url);

    // Collect request info
    const info: LogInfo = {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      status: 0,
      duration: 0,
    };

    if (options.includeHeaders) {
      info.headers = Object.fromEntries(request.headers.entries());
    }

    if (options.includeBody && request.body) {
      try {
        const clonedRequest = request.clone();
        const text = await clonedRequest.text();
        try {
          info.body = JSON.parse(text);
        } catch {
          info.body = text;
        }
      } catch {
        info.body = '[Body not readable]';
      }
    }

    // Log request
    const requestMessage = options.formatter
      ? options.formatter({ ...info, status: 0, duration: 0 })
      : `→ ${info.method} ${info.url}`;
    log(requestMessage);

    try {
      // Process request
      const response = await next();

      // Log response
      info.status = response.status;
      info.duration = Date.now() - start;

      const responseMessage = options.formatter
        ? options.formatter(info)
        : `← ${info.status} ${response.statusText || 'OK'} (${info.duration}ms)`;
      log(responseMessage);

      return response;
    } catch (error) {
      // Log error
      info.status = 500;
      info.duration = Date.now() - start;
      info.error = error as Error;

      const errorMessage = options.formatter
        ? options.formatter(info)
        : `✗ ${info.status} Error: ${(error as Error).message} (${info.duration}ms)`;
      log(errorMessage);

      throw error;
    }
  };
}

// =============================================================================
// Rate Limiter
// =============================================================================

/** Rate limit store interface. */
export interface RateLimitStore {
  increment(key: string): Promise<number>;
  decrement(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

/** In-memory rate limit store with periodic cleanup of expired entries. */
export class MemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, { count: number; resetAt: number }>();
  private lastCleanup = Date.now();

  /** Interval between cleanups (default: 60 seconds). */
  private readonly cleanupIntervalMs: number;

  constructor(
    private windowMs: number,
    options?: { cleanupIntervalMs?: number },
  ) {
    // Default cleanup interval is the window duration or 60 seconds, whichever is larger.
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? Math.max(windowMs, 60_000);
  }

  async increment(key: string): Promise<number> {
    const now = Date.now();

    // Periodic cleanup to prevent memory leaks.
    if (now - this.lastCleanup > this.cleanupIntervalMs) {
      this.cleanup(now);
    }

    const record = this.counts.get(key);

    if (!record || now > record.resetAt) {
      this.counts.set(key, { count: 1, resetAt: now + this.windowMs });
      return 1;
    }

    record.count++;
    return record.count;
  }

  async decrement(key: string): Promise<void> {
    const record = this.counts.get(key);
    if (record && record.count > 0) {
      record.count--;
    }
  }

  async reset(key: string): Promise<void> {
    this.counts.delete(key);
  }

  /** Removes all expired entries from the store. */
  private cleanup(now: number): void {
    for (const [key, record] of this.counts) {
      if (now > record.resetAt) {
        this.counts.delete(key);
      }
    }
    this.lastCleanup = now;
  }

  /** Returns the current number of tracked keys (useful for testing). */
  get size(): number {
    return this.counts.size;
  }
}

/** Rate limiter middleware configuration. */
export interface RateLimitOptions {
  /** Time window in milliseconds. */
  windowMs?: number;
  /** Maximum requests per window. */
  max?: number;
  /** Function to generate a unique key for each client. */
  keyGenerator?: (context: MiddlewareContext) => string;
  /** Store for rate limit data. */
  store?: RateLimitStore;
  /** Skip successful requests from rate limit. */
  skipSuccessfulRequests?: boolean;
  /** Skip failed requests from rate limit. */
  skipFailedRequests?: boolean;
  /** Custom handler for rate limited requests. */
  handler?: (context: MiddlewareContext) => Response | Promise<Response>;
}

/**
 * Creates a rate limiting middleware.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, rateLimit({ max: 100, windowMs: 60000 }));
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}): Middleware {
  const config = {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    keyGenerator: (ctx: MiddlewareContext) => {
      // Use IP address as default key
      const cfIp = ctx.request.headers.get('CF-Connecting-IP');
      const xForwardedFor = ctx.request.headers.get('X-Forwarded-For');
      const xRealIp = ctx.request.headers.get('X-Real-IP');
      return cfIp || xForwardedFor?.split(',')[0] || xRealIp || 'unknown';
    },
    ...options,
  };

  const store = config.store || new MemoryRateLimitStore(config.windowMs);

  return async (context, next) => {
    const key = config.keyGenerator(context);
    const current = await store.increment(key);

    if (current > config.max) {
      if (config.handler) {
        return await config.handler(context);
      }

      return new Response('Too many requests', {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(config.windowMs / 1000)),
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(Date.now() + config.windowMs).toISOString(),
        },
      });
    }

    const response = await next();

    // Optionally don't count successful/failed requests
    if (
      (config.skipSuccessfulRequests && response.status < 400) ||
      (config.skipFailedRequests && response.status >= 400)
    ) {
      await store.decrement(key);
    }

    // Add rate limit headers
    const headers = new Headers(response.headers);
    headers.set('X-RateLimit-Limit', String(config.max));
    headers.set('X-RateLimit-Remaining', String(Math.max(0, config.max - current)));
    headers.set('X-RateLimit-Reset', new Date(Date.now() + config.windowMs).toISOString());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

// =============================================================================
// Request ID
// =============================================================================

/** Request ID middleware configuration. */
export interface RequestIdOptions {
  /** Header name for request ID. */
  headerName?: string;
  /** Function to generate request ID. */
  generator?: () => string;
}

/**
 * Creates a middleware that adds a unique request ID to each request.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, requestId({ headerName: 'X-Request-ID' }));
 * ```
 */
export function requestId(options: RequestIdOptions = {}): Middleware {
  const headerName = options.headerName || 'X-Request-ID';
  const generator = options.generator || (() => crypto.randomUUID());

  return async (context, next) => {
    // Check if request already has an ID
    let id = context.request.headers.get(headerName);
    if (!id) {
      id = generator();
    }

    // Add to context
    context.requestId = id;

    // Process request
    const response = await next();

    // Add request ID to response headers
    const headers = new Headers(response.headers);
    headers.set(headerName, id);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

// =============================================================================
// Timeout
// =============================================================================

/** Timeout middleware configuration. */
export interface TimeoutOptions {
  /** Timeout in milliseconds. */
  timeout: number;
  /** Custom timeout response. */
  message?: string;
}

/**
 * Creates a middleware that times out requests after a specified duration.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, timeout({ timeout: 5000 }));
 * ```
 */
export function timeout(options: TimeoutOptions): Middleware {
  return async (context, next) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const responsePromise = next();
      const timeoutPromise = new Promise<Response>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Request timeout'));
        });
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).message === 'Request timeout') {
        return new Response(options.message || 'Request timeout', {
          status: 408,
        });
      }
      throw error;
    }
  };
}

// =============================================================================
// Content Type Validation
// =============================================================================

/** Content type validation options. */
export interface ContentTypeOptions {
  /** Expected content types. */
  types: string[];
  /** Skip validation for these methods. */
  skipMethods?: string[];
  /** Custom error message. */
  message?: string;
}

/**
 * Creates a middleware that validates request content type.
 *
 * @example
 * ```typescript
 * const apiRouter = router('/api', routes, contentType({ types: ['application/json'] }));
 * ```
 */
export function contentType(options: ContentTypeOptions): Middleware {
  const skipMethods = new Set(
    options.skipMethods?.map((m) => m.toUpperCase()) || ['GET', 'HEAD', 'OPTIONS'],
  );

  return async (context, next) => {
    if (skipMethods.has(context.request.method.toUpperCase())) {
      return next();
    }

    const contentType = context.request.headers.get('Content-Type');
    if (!contentType) {
      return new Response(options.message || 'Missing Content-Type header', {
        status: 415,
      });
    }

    const matches = options.types.some((type) => contentType.includes(type));
    if (!matches) {
      return new Response(
        options.message || `Unsupported Media Type. Expected: ${options.types.join(', ')}`,
        { status: 415 },
      );
    }

    return next();
  };
}

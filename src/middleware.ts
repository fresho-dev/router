/**
 * @fileoverview Core middleware types and utilities.
 *
 * Provides middleware support for typed-routes with a simple, composable API.
 *
 * @example Type-hinting custom context properties
 * ```typescript
 * // Define your custom context extensions
 * interface MyContext {
 *   user: { id: string; name: string };
 *   db: Database;
 * }
 *
 * // Use the generic parameter to type-hint
 * const authMiddleware: Middleware<MyContext> = async (context, next) => {
 *   context.user = await validateToken(context.request);
 *   return next();
 * };
 *
 * // Downstream middleware can access typed properties
 * const logUserMiddleware: Middleware<MyContext> = async (context, next) => {
 *   console.log(`User: ${context.user.name}`);
 *   return next();
 * };
 * ```
 */

import type { TypedParams, ExecutionContext } from './types.js';

/**
 * Context passed to middleware functions.
 *
 * Use the generic `Ext` parameter to type-hint custom properties that
 * middleware adds to the context. This is similar to typing `env` in
 * Cloudflare Workers.
 *
 * @typeParam Ext - Custom properties added by middleware (default: {})
 *
 * @example
 * ```typescript
 * interface MyContext {
 *   user: User;
 *   permissions: string[];
 * }
 *
 * const middleware: Middleware<MyContext> = async (context, next) => {
 *   context.user = await getUser();
 *   context.permissions = ['read', 'write'];
 *   return next();
 * };
 * ```
 */
export interface MiddlewareContext<Ext = {}> {
  request: Request;
  params: TypedParams<unknown, unknown, Record<string, string>>;
  env?: unknown;
  ctx?: ExecutionContext;
  [key: string]: unknown;
}

/**
 * Function to continue to the next middleware or handler.
 */
export type MiddlewareNext = () => Promise<Response>;

/**
 * Middleware function signature.
 *
 * @typeParam Ext - Custom context properties for type-hinting (default: {})
 *
 * The context receives `Partial<Ext>` so middleware can add properties that
 * don't exist yet. Downstream handlers using `route.ctx<Ext>()` will receive
 * the full typed context after middleware has run.
 *
 * @example
 * ```typescript
 * // Simple middleware without custom context
 * const logger: Middleware = async (context, next) => {
 *   console.log(context.request.url);
 *   return next();
 * };
 *
 * // Middleware with typed context (adds properties)
 * interface AuthContext { user: User }
 * const auth: Middleware<AuthContext> = async (context, next) => {
 *   context.user = await authenticate(context.request);
 *   return next();
 * };
 * ```
 */
export type Middleware<Ext = {}> = (
  context: MiddlewareContext<Ext> & Partial<Ext>,
  next: MiddlewareNext
) => Promise<Response> | Response;

/**
 * Runs a chain of middleware with a final handler.
 */
export async function runMiddleware(
  middleware: Middleware[],
  context: MiddlewareContext,
  finalHandler: () => Promise<Response>
): Promise<Response> {
  let index = 0;

  const next: MiddlewareNext = async () => {
    if (index >= middleware.length) {
      return finalHandler();
    }

    const currentMiddleware = middleware[index++];
    return await currentMiddleware(context, next);
  };

  return next();
}

/**
 * Composes multiple middleware into a single middleware.
 */
export function compose(...middleware: Middleware[]): Middleware {
  return async (context, next) => {
    return runMiddleware(middleware, context, next);
  };
}

/**
 * Creates a middleware that only runs for specific HTTP methods.
 */
export function forMethods(methods: string[], middleware: Middleware): Middleware {
  const methodSet = new Set(methods.map(m => m.toUpperCase()));
  return async (context, next) => {
    if (methodSet.has(context.request.method.toUpperCase())) {
      return middleware(context, next);
    }
    return next();
  };
}

/**
 * Creates a middleware that only runs for specific paths.
 */
export function forPaths(paths: string[] | RegExp[], middleware: Middleware): Middleware {
  return async (context, next) => {
    const url = new URL(context.request.url);
    const pathname = url.pathname;

    const matches = paths.some(path => {
      if (typeof path === 'string') {
        return pathname.startsWith(path);
      }
      return path.test(pathname);
    });

    if (matches) {
      return middleware(context, next);
    }
    return next();
  };
}

/**
 * Creates a middleware that skips for specific paths.
 */
export function skipPaths(paths: string[] | RegExp[], middleware: Middleware): Middleware {
  return async (context, next) => {
    const url = new URL(context.request.url);
    const pathname = url.pathname;

    const matches = paths.some(path => {
      if (typeof path === 'string') {
        return pathname.startsWith(path);
      }
      return path.test(pathname);
    });

    if (!matches) {
      return middleware(context, next);
    }
    return next();
  };
}
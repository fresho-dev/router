/**
 * @fileoverview Core middleware types and utilities.
 *
 * Provides middleware support for typed-routes with a simple, composable API.
 *
 * @example Type-hinting context properties
 * ```typescript
 * // Define your context type (env is required, other properties are optional in middleware)
 * interface AppContext {
 *   env: { JWT_SECRET: string; DB: D1Database };
 *   user: { id: string; name: string };
 * }
 *
 * // Middleware receives env as required, other properties as optional
 * const authMiddleware: Middleware<AppContext> = async (context, next) => {
 *   context.env.JWT_SECRET;  // typed, required
 *   context.user;            // typed as optional (may not exist yet)
 *   context.user = await validateToken(context.request);
 *   return next();
 * };
 * ```
 */

import type { ExecutionContext } from './types.js';

/**
 * Base context properties always available to middleware.
 */
interface BaseMiddlewareContext {
  request: Request;
  path: Record<string, string>;
  query: unknown;
  body: unknown;
  executionCtx?: ExecutionContext;
}

/**
 * Context passed to middleware functions.
 *
 * The `env` property is always required (extracted from Ctx if provided).
 * Other properties from Ctx are optional since middleware builds them up.
 *
 * @typeParam Ctx - Context type including env and middleware-added properties
 *
 * @example
 * ```typescript
 * interface AppContext {
 *   env: { JWT_SECRET: string };
 *   user: { id: string };
 * }
 *
 * const middleware: Middleware<AppContext> = async (context, next) => {
 *   context.env.JWT_SECRET;  // typed, required
 *   context.user;            // typed as { id: string } | undefined
 *   context.user = { id: '123' };
 *   return next();
 * };
 * ```
 */
export type MiddlewareContext<Ctx = {}> = BaseMiddlewareContext & {
  env: Ctx extends { env: infer E } ? E : unknown;
} & Partial<Omit<Ctx, 'env'>> & {
  [key: string]: unknown;
};

/**
 * Function to continue to the next middleware or handler.
 */
export type MiddlewareNext = () => Promise<Response>;

/**
 * Middleware function signature.
 *
 * @typeParam Ctx - Context type (default: {})
 *
 * @example
 * ```typescript
 * // Simple middleware without typed context
 * const logger: Middleware = async (context, next) => {
 *   console.log(context.request.url);
 *   return next();
 * };
 *
 * // Middleware with typed context
 * interface AppContext {
 *   env: { JWT_SECRET: string };
 *   user: { id: string };
 * }
 * const auth: Middleware<AppContext> = async (context, next) => {
 *   const secret = context.env.JWT_SECRET;  // typed, required
 *   context.user = { id: '123' };           // adds to context
 *   return next();
 * };
 * ```
 */
export type Middleware<Ctx = {}> = (
  context: MiddlewareContext<Ctx>,
  next: MiddlewareNext
) => Promise<Response> | Response;

/**
 * Runs a chain of middleware with a final handler.
 *
 * Middleware are executed in order. Each middleware receives the context and
 * a `next` function. Calling `next()` continues to the next middleware or the
 * final handler. Returning without calling `next()` short-circuits the chain.
 *
 * @param middleware - Array of middleware functions to run
 * @param context - The request context
 * @param finalHandler - Handler to call after all middleware complete
 * @returns The response from the middleware chain or final handler
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
 *
 * Useful for grouping related middleware together.
 *
 * @example
 * ```typescript
 * const security = compose(
 *   cors(),
 *   rateLimit({ max: 100 }),
 *   errorHandler(),
 * );
 *
 * const api = router('/api', routes, [security]);
 * ```
 *
 * @param middleware - Middleware functions to compose
 * @returns A single middleware that runs all provided middleware in order
 */
export function compose(...middleware: Middleware[]): Middleware {
  return async (context, next) => {
    return runMiddleware(middleware, context, next);
  };
}
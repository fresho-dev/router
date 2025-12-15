import type { Method } from './types.js';

// =============================================================================
// Proxy Types
// =============================================================================

const PREFIXED_HTTP_METHODS = new Set([
  '$get',
  '$post',
  '$put',
  '$patch',
  '$delete',
  '$options',
  '$head',
]);

/**
 * Configuration for the recursive proxy.
 */
export interface RecursiveProxyOptions {
  /**
   * Callback to execute when a method is invoked.
   * @param segments - The path segments accumulated so far.
   * @param method - The HTTP method to execute (e.g. 'get', 'post').
   * @param options - The arguments passed to the method execution (e.g. { query, body }).
   */
  onRequest: (segments: string[], method: Method, options?: unknown) => Promise<unknown>;
}

/**
 * Creates a recursive proxy that accumulates path segments and traps method calls.
 *
 * Use cases:
 * 1. HTTP Client: Accumulates path segments and executes HTTP requests on method calls.
 * 2. Local Client: Accumulates path segments and invokes local handlers on method calls.
 *
 * @param config - The proxy configuration.
 * @param segments - The initial path segments (default: []).
 */
export function createRecursiveProxy(
  config: RecursiveProxyOptions,
  segments: string[] = [],
): unknown {
  // The proxy target is a function so that 'apply' can be intercepted (for the root call or recursive calls).
  // For the root client, this allows `client()` to be called (implicit GET /).
  // For nested paths, it allows `client.some.path()` (implicit GET /some/path).
  const callable = (options?: unknown) => {
    return config.onRequest(segments, 'get', options);
  };

  return new Proxy(callable, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;

      // Handle standard function methods and toJSON
      // This prevents 'apply', 'call', etc. from being treated as path segments.
      if (
        prop === 'apply' ||
        prop === 'call' ||
        prop === 'bind' ||
        prop === 'toString' ||
        prop === 'toJSON'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (_target as any)[prop];
      }

      // Check if this property is a method trap.
      if (PREFIXED_HTTP_METHODS.has(prop)) {
        const method = prop.slice(1) as Method;
        return (options?: unknown) => {
          return config.onRequest(segments, method, options);
        };
      }

      // Otherwise = nested path segment.
      return createRecursiveProxy(config, [...segments, prop]);
    },

    // Trap direct function calls (e.g. client() or client.path())
    apply(_target, _thisArg, args) {
      return callable(args[0]);
    },
  });
}

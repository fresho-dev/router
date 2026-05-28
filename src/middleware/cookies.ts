/**
 * @fileoverview Cookie parsing/serialization and the cookies() middleware.
 *
 * Reads the request `Cookie` header into `context.cookies` and installs a
 * `context.setCookie` helper that serializes per RFC 6265 and appends
 * `Set-Cookie` headers to the outgoing response. Dependency-free, Web APIs only.
 */

import type { Middleware } from '../middleware.js';

/** Options for serializing a cookie into a `Set-Cookie` header value. */
export interface CookieOptions {
  /** Lifetime in seconds, serialized as `Max-Age`. */
  maxAge?: number;
  /** Absolute expiry, serialized as `Expires`. */
  expires?: Date;
  /** Restricts the cookie to a path prefix. */
  path?: string;
  /** Restricts the cookie to a domain. */
  domain?: string;
  /** Only send the cookie over HTTPS. */
  secure?: boolean;
  /** Hide the cookie from client-side JavaScript. */
  httpOnly?: boolean;
  /** Cross-site sending policy. */
  sameSite?: 'strict' | 'lax' | 'none';
}

/** Helper installed on the context to queue a cookie for the response. */
export type SetCookie = (name: string, value: string, options?: CookieOptions) => void;

/**
 * Decodes a cookie value, falling back to the raw value if it is malformed.
 *
 * Cookies are URL-encoded on write (see {@link serializeCookie}); decoding here
 * keeps round-trips lossless without throwing on hand-crafted values.
 */
function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses a `Cookie` request header into a plain map of name to value.
 *
 * Returns an empty object for a missing or empty header. When a name appears
 * more than once the first value wins, matching the common `cookie` package.
 */
export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }

  // Split on the standard "; " delimiter, tolerating arbitrary surrounding space.
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) {
      continue;
    }

    // Split on the first "=" only so values may themselves contain "=".
    const name = pair.slice(0, separator).trim();
    if (name && !(name in cookies)) {
      cookies[name] = tryDecode(pair.slice(separator + 1).trim());
    }
  }

  return cookies;
}

/**
 * Serializes a cookie into a `Set-Cookie` header value per RFC 6265.
 *
 * The value is URL-encoded; attributes are appended in a stable order.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  // Attributes, in the conventional Set-Cookie order.
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.sameSite) {
    // Capitalize to match the spec's token casing (Strict / Lax / None).
    parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  }

  return parts.join('; ');
}

/**
 * Creates a middleware that parses request cookies and enables setting them.
 *
 * Merges the parsed cookies into `context.cookies` and installs a
 * `context.setCookie(name, value, options)` helper. Each `setCookie` call adds
 * a separate `Set-Cookie` header to the response (append, not overwrite), so a
 * handler may set multiple cookies.
 *
 * @example
 * ```typescript
 * const api = router('/api', routes, cookies());
 * // in a handler: c.cookies['session']; c.setCookie('session', id, { httpOnly: true });
 * ```
 */
export function cookies(): Middleware {
  return async (context, next) => {
    // Read side: parse the incoming Cookie header once.
    context.cookies = parseCookies(context.request.headers.get('Cookie'));

    // Write side: queue serialized cookies for the outgoing response.
    const pending: string[] = [];
    context.setCookie = ((name, value, options) => {
      pending.push(serializeCookie(name, value, options));
    }) satisfies SetCookie;

    const response = await next();

    // Leave the response untouched when no cookies were set.
    if (pending.length === 0) {
      return response;
    }

    // Append each cookie as its own Set-Cookie header.
    const headers = new Headers(response.headers);
    for (const cookie of pending) {
      headers.append('Set-Cookie', cookie);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * @fileoverview Basic HTTP authentication utilities.
 *
 * Provides functions for parsing and encoding Basic authentication credentials.
 *
 * @example
 * ```typescript
 * import { parseBasicAuth, encodeBasicAuth } from '@fresho/router/auth';
 *
 * // Parse credentials from Authorization header
 * const credentials = parseBasicAuth('Basic dXNlcm5hbWU6cGFzc3dvcmQ=');
 * if (credentials) {
 *   console.log(credentials.username); // 'username'
 *   console.log(credentials.password); // 'password'
 * }
 *
 * // Create an Authorization header value
 * const header = encodeBasicAuth('username', 'password');
 * // 'Basic dXNlcm5hbWU6cGFzc3dvcmQ='
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/** Parsed Basic authentication credentials. */
export interface BasicCredentials {
  /** The username from the credentials. */
  username: string;
  /** The password from the credentials. */
  password: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parses Basic authentication credentials from an Authorization header value.
 *
 * @param authHeader - The full Authorization header value (e.g., 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=')
 * @returns The parsed credentials, or null if parsing fails
 *
 * @example
 * ```typescript
 * const header = request.headers.get('Authorization');
 * const credentials = parseBasicAuth(header);
 * if (credentials) {
 *   // Verify credentials
 *   const isValid = await verifyPassword(credentials.username, credentials.password);
 * }
 * ```
 */
export function parseBasicAuth(authHeader: string | null): BasicCredentials | null {
  if (!authHeader?.startsWith('Basic ')) {
    return null;
  }

  try {
    const encoded = authHeader.slice(6);
    const decoded = atob(encoded);
    const colonIndex = decoded.indexOf(':');

    if (colonIndex === -1) {
      return null;
    }

    return {
      username: decoded.substring(0, colonIndex),
      password: decoded.substring(colonIndex + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Encodes credentials into a Basic authentication header value.
 *
 * @param username - The username
 * @param password - The password
 * @returns The Authorization header value (e.g., 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=')
 *
 * @example
 * ```typescript
 * const authHeader = encodeBasicAuth('admin', 'secret');
 * fetch('/api/endpoint', {
 *   headers: { Authorization: authHeader }
 * });
 * ```
 */
export function encodeBasicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

/**
 * Extracts the raw base64-encoded credentials from an Authorization header.
 *
 * @param authHeader - The full Authorization header value
 * @returns The base64 string, or null if not a Basic auth header
 */
export function extractBasicAuthToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Basic ')) {
    return null;
  }
  return authHeader.slice(6);
}

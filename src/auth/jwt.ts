/**
 * @fileoverview JWT signing and verification utilities.
 *
 * Provides functions for creating and validating JSON Web Tokens using
 * the Web Crypto API. Compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @example
 * ```typescript
 * import { jwtSign, jwtVerify } from '@fresho/router/auth';
 *
 * // Sign a token
 * const token = await jwtSign(
 *   { uid: 'user-123', role: 'admin' },
 *   'your-secret-key',
 *   { expiresIn: '1h' }
 * );
 *
 * // Verify a token
 * const payload = await jwtVerify(token, 'your-secret-key');
 * console.log(payload.uid); // 'user-123'
 * ```
 */

// =============================================================================
// Types
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

/** Supported HMAC algorithms for JWT signing/verification. */
export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512';

/** JWT secret value. */
export type JwtSecret = string | ArrayBuffer | CryptoKey;

/** Options for signing a JWT. */
export interface SignJwtOptions {
  /** Signing algorithm (default: 'HS256'). */
  algorithm?: JwtAlgorithm;
  /** Expiration time (e.g., '1h', '7d', '30m', or seconds as number). */
  expiresIn?: string | number;
  /** Not before time (e.g., '5m', or seconds as number). */
  notBefore?: string | number;
  /** Issuer claim. */
  issuer?: string;
  /** Audience claim. */
  audience?: string | string[];
  /** Subject claim. */
  subject?: string;
  /** Custom issued-at timestamp (defaults to now). */
  issuedAt?: number | Date;
}

/** Options for verifying a JWT. */
export interface VerifyJwtOptions {
  /** Allowed algorithms (default: ['HS256']). */
  algorithms?: JwtAlgorithm[];
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Maps JWT algorithm names to Web Crypto hash names. */
const ALGORITHM_MAP: Record<JwtAlgorithm, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

/**
 * Parses a duration string (e.g., '1h', '7d', '30m') to seconds.
 */
function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration;

  const match = duration.match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${duration}. Use formats like '1h', '7d', '30m', '60s'.`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    case 'w':
      return value * 60 * 60 * 24 * 7;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Base64url encodes a string or Uint8Array.
 */
function base64urlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Signs a JWT token using Web Crypto API.
 *
 * Uses only Web Crypto API, compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @param payload - The JWT payload (custom claims)
 * @param secret - The signing secret (string, ArrayBuffer, or CryptoKey)
 * @param options - Optional signing options (algorithm, expiresIn, issuer, etc.)
 * @returns The signed JWT token string
 *
 * @example
 * ```typescript
 * // Basic usage (HS256 by default)
 * const token = await jwtSign(
 *   { uid: 'user-123', role: 'admin' },
 *   'your-secret-key',
 *   { expiresIn: '1h' }
 * );
 *
 * // With HS512 algorithm
 * const token = await jwtSign(
 *   { uid: 'user-123' },
 *   process.env.JWT_SECRET,
 *   { algorithm: 'HS512', expiresIn: '7d' }
 * );
 * ```
 */
export async function jwtSign(
  payload: Record<string, unknown>,
  secret: JwtSecret,
  options: SignJwtOptions = {},
): Promise<string> {
  const algorithm = options.algorithm || 'HS256';
  const hashAlg = ALGORITHM_MAP[algorithm];

  const now = options.issuedAt
    ? options.issuedAt instanceof Date
      ? Math.floor(options.issuedAt.getTime() / 1000)
      : options.issuedAt
    : Math.floor(Date.now() / 1000);

  // Build the final payload with registered claims.
  const finalPayload: JwtPayload = {
    ...payload,
    iat: now,
  };

  if (options.expiresIn !== undefined) {
    finalPayload.exp = now + parseDuration(options.expiresIn);
  }

  if (options.notBefore !== undefined) {
    finalPayload.nbf = now + parseDuration(options.notBefore);
  }

  if (options.issuer !== undefined) {
    finalPayload.iss = options.issuer;
  }

  if (options.audience !== undefined) {
    finalPayload.aud = options.audience;
  }

  if (options.subject !== undefined) {
    finalPayload.sub = options.subject;
  }

  // Create header.
  const header = { alg: algorithm, typ: 'JWT' };

  // Encode header and payload.
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(finalPayload));
  const data = `${headerB64}.${payloadB64}`;

  // Import key for signing.
  let key: CryptoKey;
  if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: hashAlg }, false, [
      'sign',
    ]);
  }

  // Sign the data.
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  const signatureB64 = base64urlEncode(new Uint8Array(signatureBuffer));

  return `${data}.${signatureB64}`;
}

/**
 * Verifies a JWT token using Web Crypto API.
 *
 * Uses only Web Crypto API, compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @param token - The JWT token string to verify
 * @param secret - The secret used to sign the token (string, ArrayBuffer, or CryptoKey)
 * @param options - Optional verification options
 * @returns The decoded JWT payload
 * @throws Error if the token is invalid, expired, or not yet valid
 *
 * @example
 * ```typescript
 * import { jwtVerify } from '@fresho/router/auth';
 *
 * try {
 *   const payload = await jwtVerify(token, 'your-secret-key');
 *   console.log(payload.sub); // user ID
 * } catch (error) {
 *   console.error('Invalid token:', error.message);
 * }
 *
 * // With specific algorithms
 * const payload = await jwtVerify(token, secret, { algorithms: ['HS512'] });
 * ```
 */
export async function jwtVerify(
  token: string,
  secret: JwtSecret,
  options: VerifyJwtOptions = {},
): Promise<JwtPayload> {
  const algorithms = options.algorithms || ['HS256'];

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header.
  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
  if (!algorithms.includes(header.alg)) {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Get the hash algorithm for the JWT algorithm.
  const hashAlg = ALGORITHM_MAP[header.alg as JwtAlgorithm];
  if (!hashAlg) {
    throw new Error(`Unknown algorithm: ${header.alg}`);
  }

  // Decode payload.
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

  // Verify signature using Web Crypto API.
  const data = `${headerB64}.${payloadB64}`;
  const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );

  let key: CryptoKey;
  if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: hashAlg }, false, [
      'verify',
    ]);
  }

  const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(data));

  if (!valid) {
    throw new Error('Invalid signature');
  }

  // Check expiration.
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  // Check not before.
  if (payload.nbf && payload.nbf > Date.now() / 1000) {
    throw new Error('Token not yet valid');
  }

  return payload as JwtPayload;
}

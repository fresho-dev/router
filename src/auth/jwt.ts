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

/** Supported algorithms for JWT signing/verification. */
export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384';

/**
 * JWT secret value: an HMAC secret, a CryptoKey (HMAC, or RSA/EC public or private key),
 * or a remote key set from {@link createJwks}.
 */
export type JwtSecret = string | BufferSource | CryptoKey | Jwks;

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
  /** Key ID header (`kid`), used by verifiers to pick a key from a JWKS. */
  keyId?: string;
  /** Custom issued-at timestamp (defaults to now). */
  issuedAt?: number | Date;
}

/** Options for verifying a JWT. */
export interface VerifyJwtOptions {
  /** Allowed algorithms (default: ['HS256'] for HMAC secrets, ['RS256'] otherwise). */
  algorithms?: JwtAlgorithm[];
  /** Required issuer (`iss`); any of the given values is accepted. */
  issuer?: string | string[];
  /** Required audience (`aud`); the token must contain at least one of the given values. */
  audience?: string | string[];
  /** Seconds of clock skew allowed when checking `exp` and `nbf` (default: 0). */
  clockTolerance?: number;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Web Crypto parameters for each JWT algorithm, used for key import, signing and verifying. */
interface AlgorithmSpec {
  name: 'HMAC' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'ECDSA';
  hash: string;
  saltLength?: number;
  namedCurve?: string;
}

const ALGORITHMS: Record<JwtAlgorithm, AlgorithmSpec> = {
  HS256: { name: 'HMAC', hash: 'SHA-256' },
  HS384: { name: 'HMAC', hash: 'SHA-384' },
  HS512: { name: 'HMAC', hash: 'SHA-512' },
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  RS384: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
  RS512: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  PS256: { name: 'RSA-PSS', hash: 'SHA-256', saltLength: 32 },
  PS384: { name: 'RSA-PSS', hash: 'SHA-384', saltLength: 48 },
  PS512: { name: 'RSA-PSS', hash: 'SHA-512', saltLength: 64 },
  ES256: { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256' },
  ES384: { name: 'ECDSA', hash: 'SHA-384', namedCurve: 'P-384' },
};

/** Checks that a CryptoKey was created for exactly this algorithm. */
function keyMatches(key: CryptoKey, spec: AlgorithmSpec): boolean {
  const alg = key.algorithm as KeyAlgorithm & {
    hash?: { name: string };
    namedCurve?: string;
    modulusLength?: number;
  };
  if (alg.name !== spec.name) return false;
  if (spec.name === 'ECDSA') return alg.namedCurve === spec.namedCurve;
  // Web Crypto accepts RSA keys too weak for signatures (RFC 7518 §3.3 requires 2048 bits).
  if (spec.name !== 'HMAC' && (alg.modulusLength ?? 0) < 2048) return false;
  return alg.hash?.name === spec.hash;
}

/** Checks that a JWK may be used to verify this algorithm. */
function jwkMatches(jwk: JsonWebKey & { kid?: string }, alg: JwtAlgorithm): boolean {
  const spec = ALGORITHMS[alg];
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (spec.name === 'ECDSA') return jwk.kty === 'EC' && jwk.crv === spec.namedCurve;
  return spec.name !== 'HMAC' && jwk.kty === 'RSA';
}

/** Resolves the CryptoKey for a token, rejecting keys that don't fit its algorithm. */
async function resolveKey(
  secret: JwtSecret,
  alg: JwtAlgorithm,
  kid: string | undefined,
  usage: 'sign' | 'verify',
): Promise<CryptoKey> {
  const spec = ALGORITHMS[alg];
  let key: CryptoKey;
  if (secret instanceof Jwks) {
    if (spec.name === 'HMAC') throw new Error(`Key does not match algorithm: ${alg}`);
    key = await secret.getKey(alg, kid);
  } else if (secret instanceof CryptoKey) {
    key = secret;
  } else {
    if (spec.name !== 'HMAC') throw new Error(`Key does not match algorithm: ${alg}`);
    const keyData = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
    key = await crypto.subtle.importKey('raw', keyData, spec, false, [usage]);
  }
  if (!keyMatches(key, spec)) throw new Error(`Key does not match algorithm: ${alg}`);
  return key;
}

/** Decodes a base64url string to bytes. */
function base64urlDecode(data: string): Uint8Array<ArrayBuffer> {
  // Strict alphabet so each token has one encoding; atob alone tolerates padding and whitespace.
  if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('Invalid JWT format');
  return Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

/** Decodes a base64url JSON segment, without echoing its content in errors. */
function decodeSegment(data: string): any {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(base64urlDecode(data)));
  } catch {}
  if (typeof value !== 'object' || value === null) throw new Error('Invalid JWT format');
  return value;
}

/** Returns true if `actual` (a claim value) contains any of `expected`. */
function claimMatches(actual: unknown, expected: string | string[]): boolean {
  const values = Array.isArray(actual) ? actual : [actual];
  return [expected].flat().some((e) => values.includes(e));
}

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
 * @param secret - The signing secret (string, bytes, or private/HMAC CryptoKey)
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
  const spec = ALGORITHMS[algorithm];
  if (!spec) throw new Error(`Unknown algorithm: ${algorithm}`);

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
  const header = {
    alg: algorithm,
    typ: 'JWT',
    ...(options.keyId !== undefined && { kid: options.keyId }),
  };

  // Encode header and payload.
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(finalPayload));
  const data = `${headerB64}.${payloadB64}`;

  if (secret instanceof Jwks) throw new Error('Cannot sign with a JWKS');
  const key = await resolveKey(secret, algorithm, undefined, 'sign');
  const signatureBuffer = await crypto.subtle.sign(spec, key, new TextEncoder().encode(data));

  const signatureB64 = base64urlEncode(new Uint8Array(signatureBuffer));

  return `${data}.${signatureB64}`;
}

/**
 * Verifies a JWT token using Web Crypto API.
 *
 * Uses only Web Crypto API, compatible with Cloudflare Workers, Deno, and browsers.
 *
 * @param token - The JWT token string to verify
 * @param secret - The verification key (string, bytes, CryptoKey, or JWKS)
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
  const symmetric =
    !(secret instanceof Jwks) && !(secret instanceof CryptoKey && secret.algorithm.name !== 'HMAC');
  const algorithms = options.algorithms || [symmetric ? 'HS256' : 'RS256'];

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header; the allowed list, not the token, decides which algorithms are acceptable.
  const header = decodeSegment(headerB64);
  if (!algorithms.includes(header.alg) || !Object.hasOwn(ALGORITHMS, header.alg)) {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }
  const alg = header.alg as JwtAlgorithm;
  if (header.kid !== undefined && typeof header.kid !== 'string') {
    throw new Error('Invalid JWT format');
  }
  // No extensions are supported, so any critical one must be rejected (RFC 7515 §4.1.11).
  if (header.crit !== undefined) {
    throw new Error('Unsupported critical header');
  }
  const kid: string | undefined = header.kid;

  const key = await resolveKey(secret, alg, kid, 'verify');
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify(
    ALGORITHMS[alg],
    key,
    base64urlDecode(signatureB64),
    data,
  );

  if (!valid) {
    throw new Error('Invalid signature');
  }

  const payload = decodeSegment(payloadB64);

  const now = Date.now() / 1000;
  const tolerance = options.clockTolerance ?? 0;
  if (
    payload.exp !== undefined &&
    !(typeof payload.exp === 'number' && payload.exp + tolerance >= now)
  ) {
    throw new Error('Token expired');
  }
  if (
    payload.nbf !== undefined &&
    !(typeof payload.nbf === 'number' && payload.nbf - tolerance <= now)
  ) {
    throw new Error('Token not yet valid');
  }

  if (
    options.issuer !== undefined &&
    (typeof payload.iss !== 'string' || !claimMatches(payload.iss, options.issuer))
  ) {
    throw new Error('Invalid issuer');
  }

  if (options.audience !== undefined && !claimMatches(payload.aud, options.audience)) {
    throw new Error('Invalid audience');
  }

  return payload as JwtPayload;
}

// =============================================================================
// Remote JWKS
// =============================================================================

/** How long fetched keys are trusted before the set is reloaded. */
const JWKS_MAX_AGE_MS = 10 * 60 * 1000;

/** Minimum time between fetch attempts, successful or not. */
const JWKS_COOLDOWN_MS = 30 * 1000;

/** Abort a JWKS fetch that takes longer than this. */
const JWKS_TIMEOUT_MS = 5 * 1000;

/** A remote JSON Web Key Set, fetched lazily and cached. Create with {@link createJwks}. */
export class Jwks {
  private keys: (JsonWebKey & { kid?: string })[] = [];
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private attemptedAt = Number.NEGATIVE_INFINITY;
  private pending?: Promise<void>;

  constructor(readonly url: string) {}

  /** Returns the verification key for `alg` and `kid`, reloading when stale or the kid is unknown. */
  async getKey(alg: JwtAlgorithm, kid: string | undefined): Promise<CryptoKey> {
    if (Date.now() - this.fetchedAt > JWKS_MAX_AGE_MS) await this.refresh();
    let candidates = this.match(alg, kid);
    if (candidates.length === 0) {
      await this.refresh();
      candidates = this.match(alg, kid);
    }
    // Without a kid the choice must be unambiguous.
    if (candidates.length !== 1) throw new Error('No matching key in JWKS');
    return crypto.subtle.importKey('jwk', candidates[0], ALGORITHMS[alg], false, ['verify']);
  }

  private match(alg: JwtAlgorithm, kid: string | undefined) {
    return this.keys.filter((k) => (kid === undefined || k.kid === kid) && jwkMatches(k, alg));
  }

  /** Joins an in-flight load or starts one at most once per cooldown; keeps old keys on failure. */
  private async refresh(): Promise<void> {
    if (!this.pending) {
      if (Date.now() - this.attemptedAt < JWKS_COOLDOWN_MS) return;
      this.attemptedAt = Date.now();
      this.pending = this.load().finally(() => {
        this.pending = undefined;
      });
    }
    try {
      await this.pending;
    } catch (error) {
      if (this.keys.length === 0) throw error;
    }
  }

  private async load(): Promise<void> {
    const response = await fetch(this.url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
    const body = (await response.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter((k) => typeof k === 'object' && k !== null)
      : [];
    if (keys.length === 0) throw new Error('JWKS response has no keys');
    this.keys = keys;
    this.fetchedAt = Date.now();
  }
}

/**
 * Creates a cached remote key set for verifying tokens from an OAuth/OIDC provider.
 *
 * Create it once (e.g. at module scope) and pass it as the secret. Keys are selected by the
 * token's `kid` and must match its algorithm; an unknown `kid` triggers a rate-limited reload.
 *
 * @example
 * ```typescript
 * const jwks = createJwks('https://example.auth0.com/.well-known/jwks.json');
 * const payload = await jwtVerify(token, jwks, {
 *   algorithms: ['RS256'],
 *   issuer: 'https://example.auth0.com/',
 *   audience: 'https://api.example.com',
 * });
 * ```
 */
export function createJwks(url: string | URL): Jwks {
  return new Jwks(String(url));
}

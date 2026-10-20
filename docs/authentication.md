# Authentication

@fresho/router provides flexible authentication support for both token-based and cookie-based auth flows.

## Table of Contents

- [Overview](#overview)
- [Import Paths](#import-paths)
- [Cookie-Based Auth](#cookie-based-auth)
- [Token-Based Auth](#token-based-auth)
- [Token Refresh](#token-refresh)
- [API Reference](#api-reference)
  - [jwtSign](#jwtsign)
  - [jwtVerify](#jwtverify)
  - [createJwks](#createjwks)
  - [jwtAuth](#jwtauth)

---

## Overview

There are two main approaches to authentication:

| Approach | Best For | Token Storage | Client Complexity |
|----------|----------|---------------|-------------------|
| **Cookies** | Web apps (same-origin) | httpOnly cookie (server-managed) | Minimal |
| **Bearer tokens** | SPAs, mobile apps, cross-origin | Memory or secure storage | Moderate |

Both approaches use the same server-side middleware (`jwtAuth`) - the difference is where the token is stored and how it's sent.

---

## Import Paths

Authentication utilities are available from two paths:

```typescript
// Standalone utilities (JWT, Basic Auth, OAuth)
import { jwtSign, jwtVerify, parseBasicAuth } from '@fresho/router/auth';

// Middleware wrappers (also re-exports jwtSign/jwtVerify for convenience)
import { jwtAuth, basicAuth, bearerAuth, jwtSign, jwtVerify } from '@fresho/router/middleware';
```

Use `@fresho/router/auth` when you need:
- JWT signing/verification without middleware
- Basic auth parsing utilities
- OAuth state encoding, token exchange, etc.

Use `@fresho/router/middleware` when you need:
- Authentication middleware (`jwtAuth`, `basicAuth`, `bearerAuth`)
- Convenience access to `jwtSign`/`jwtVerify` alongside middleware

---

## Cookie-Based Auth

The simplest approach for web applications. The server sets an httpOnly cookie, and the browser automatically sends it with every request.

### Server

```typescript
import { route, router } from '@fresho/router';
import { jwtAuth, jwtSign } from '@fresho/router/middleware';

const JWT_SECRET = process.env.JWT_SECRET!;

// Public routes (no auth middleware)
const publicRoutes = router({
  login: router({
    post: route({
      body: { email: 'string', password: 'string' },
      handler: async (c) => {
        const user = await db.findUser(c.body.email, c.body.password);
        if (!user) {
          return new Response('Invalid credentials', { status: 401 });
        }

        const token = await jwtSign(
          { email: user.email },
          JWT_SECRET,
          { expiresIn: '7d', subject: user.id }
        );

        return new Response(JSON.stringify({ success: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
          },
        });
      },
    }),
  }),

  logout: router({
    post: async () => {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        },
      });
    },
  }),
});

// Protected routes (with auth middleware)
const protectedRoutes = router({
  profile: router({
    get: route.ctx<{ user: { id: string; email: string } }>()({
      handler: async (c) => ({
        id: c.user.id,
        email: c.user.email,
      }),
    }),
  }),
},
  jwtAuth({
    secret: JWT_SECRET,
    claims: (payload) => ({
      user: { id: payload.sub, email: payload.email },
    }),
  })
);

// Combine into API
const api = router({
  auth: publicRoutes,
  api: protectedRoutes,
});

export default { fetch: api.handler() };
```

### Client

```typescript
import { createHttpClient } from '@fresho/router';
import type { api } from './server.js';

const client = createHttpClient<typeof api>({
  baseUrl: 'https://api.example.com',
  credentials: 'include',  // Send cookies with every request
});

// Login - server sets httpOnly cookie
await client.auth.login.$post({
  body: { email: 'alice@example.com', password: 'secret' },
});

// All subsequent requests automatically include the cookie
const profile = await client.api.profile();
console.log(profile.email);

// Logout - server clears the cookie
await client.auth.logout.$post();
```

### Cookie Options

| Option | Recommended Value | Purpose |
|--------|-------------------|---------|
| `HttpOnly` | Always | Prevents JavaScript access (XSS protection) |
| `Secure` | Always in production | Only send over HTTPS |
| `SameSite` | `Strict` or `Lax` | CSRF protection |
| `Path` | `/` | Cookie scope |
| `Max-Age` | Match token expiry | Cookie lifetime in seconds |

---

## Token-Based Auth

For SPAs, mobile apps, or cross-origin requests where cookies don't work well.

### Server

Same as cookie-based, but return the token in the response body instead of a cookie:

```typescript
login: router({
  post: route({
    body: { email: 'string', password: 'string' },
    handler: async (c) => {
      const user = await db.findUser(c.body.email, c.body.password);
      if (!user) {
        return new Response('Invalid credentials', { status: 401 });
      }

      const token = await jwtSign(
        { email: user.email },
        JWT_SECRET,
        { expiresIn: '1h', subject: user.id }
      );

      return { token };
    },
  }),
})
```

### Client

Use dynamic headers to include the token:

```typescript
import { createHttpClient } from '@fresho/router';
import type { api } from './server.js';

// Token storage (use your state management in practice)
let token: string | null = null;

const client = createHttpClient<typeof api>({
  baseUrl: 'https://api.example.com',
  headers: {
    // Dynamic header - called on each request
    'Authorization': () => token ? `Bearer ${token}` : null,
  },
});

// Login - store token in memory
const result = await client.auth.login.$post({
  body: { email: 'alice@example.com', password: 'secret' },
});
token = result.token;

// Subsequent requests include the Authorization header
const profile = await client.api.profile();
```

---

## Token Refresh

To avoid forcing users to re-login when tokens expire, implement a refresh flow.

### Proactive Refresh

Refresh the token before it expires using an async header function:

```typescript
import { jwtSign } from '@fresho/router/middleware';

let token: string | null = null;
let tokenExp: number = 0;

// Parse expiry from JWT (simplified - use a proper JWT decode in production)
function getTokenExp(jwt: string): number {
  const payload = JSON.parse(atob(jwt.split('.')[1]));
  return payload.exp * 1000;
}

const client = createHttpClient<typeof api>({
  baseUrl: 'https://api.example.com',
  headers: {
    'Authorization': async () => {
      if (!token) return null;

      // Refresh if token expires in < 5 minutes
      if (tokenExp - Date.now() < 5 * 60 * 1000) {
        const result = await client.api.refresh.$post();
        token = result.token;
        tokenExp = getTokenExp(token);
      }

      return `Bearer ${token}`;
    },
  },
});
```

### Server-Side Refresh Endpoint

```typescript
refresh: router({
  post: route.ctx<{ user: { id: string; email: string } }>()({
    handler: async (c) => {
      // Issue a new token with fresh expiry
      const token = await jwtSign(
        { email: c.user.email },
        JWT_SECRET,
        { expiresIn: '1h', subject: c.user.id }
      );
      return { token };
    },
  }),
})
```

---

## API Reference

### jwtSign

Signs a JWT token using Web Crypto API. Compatible with Cloudflare Workers, Deno, and browsers.

```typescript
import { jwtSign } from '@fresho/router/auth';
// Or: import { jwtSign } from '@fresho/router/middleware';

const token = await jwtSign(
  { email: 'user@example.com', role: 'admin' },  // Custom claims
  'your-secret-key',                              // Secret
  {
    algorithm: 'HS256',   // HS256/384/512, or RS*, PS*, ES256/384 with a private CryptoKey
    keyId: 'key-1',       // kid header (optional)
    expiresIn: '7d',      // Token lifetime
    subject: 'user-123',  // sub claim (typically user ID)
    issuer: 'my-app',     // iss claim
    audience: 'my-api',   // aud claim
  }
);
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `algorithm` | `JwtAlgorithm` | Signing algorithm (default: `'HS256'`); asymmetric algorithms need a private `CryptoKey` |
| `keyId` | `string` | `kid` header, used by verifiers to pick a key from a JWKS |
| `expiresIn` | `string \| number` | Token lifetime: `'1h'`, `'7d'`, `'30m'`, or seconds |
| `notBefore` | `string \| number` | Token not valid until this time from now |
| `subject` | `string` | `sub` claim (typically user ID) |
| `issuer` | `string` | `iss` claim |
| `audience` | `string \| string[]` | `aud` claim |
| `issuedAt` | `number \| Date` | Custom `iat` (defaults to now) |

**Duration formats:** `'60s'`, `'30m'`, `'1h'`, `'7d'`, `'2w'`

### jwtVerify

Verifies a JWT token and returns the payload. Use this when you need to verify tokens outside of the middleware context.

```typescript
import { jwtVerify } from '@fresho/router/auth';
// Or: import { jwtVerify } from '@fresho/router/middleware';

try {
  const payload = await jwtVerify(token, 'your-secret-key');
  console.log(payload.sub); // user ID
  console.log(payload.exp); // expiration timestamp
} catch (error) {
  console.error('Invalid token:', error.message);
}

// With specific algorithms
const payload = await jwtVerify(token, secret, { algorithms: ['HS512'] });
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `algorithms` | `JwtAlgorithm[]` | Allowed algorithms (default: `['HS256']` for HMAC secrets, `['RS256']` otherwise) |
| `issuer` | `string \| string[]` | Required `iss`; any listed value is accepted |
| `audience` | `string \| string[]` | Required `aud`; the token must contain at least one listed value |
| `clockTolerance` | `number` | Seconds of clock skew allowed on `exp` and `nbf` (default: `0`); 30-60 is typical for third-party tokens |

**Supported algorithms:** `HS256`, `HS384`, `HS512` (string, `ArrayBuffer`/`Uint8Array` or HMAC `CryptoKey`), and `RS256/384/512`, `PS256/384/512`, `ES256/384` (public `CryptoKey` or JWKS). A key is only used for the algorithm it was created for, so an `HS256` token can never be checked against a public key. RSA keys shorter than 2048 bits are rejected.

**Throws:**
- `'Invalid JWT format'` - Token doesn't have 3 parts or a segment isn't a JSON object
- `'Unsupported algorithm'` - Token uses algorithm not in allowed list
- `'Key does not match algorithm'` - The key or JWKS can't verify the token's algorithm
- `'No matching key in JWKS'` - No key (or more than one, when the token has no `kid`) fits the token
- `'Invalid signature'` - Signature verification failed
- `'Token expired'` - Token's `exp` claim is in the past
- `'Token not yet valid'` - Token's `nbf` claim is in the future
- `'Invalid issuer'` / `'Invalid audience'` - `iss` or `aud` doesn't match

### createJwks

Creates a cached remote JSON Web Key Set for verifying tokens issued by an OAuth or OpenID Connect provider (Auth0, Okta, Entra ID, Cognito, Keycloak, Google, ...). Create it once, at module scope, and pass it wherever a secret is expected.

```typescript
import { createJwks, jwtVerify } from '@fresho/router/auth';

const jwks = createJwks('https://example.auth0.com/.well-known/jwks.json');

const payload = await jwtVerify(token, jwks, {
  algorithms: ['RS256'],
  issuer: 'https://example.auth0.com/',
  audience: 'https://api.example.com',
});
```

- Keys are picked by the token's `kid` and must match its algorithm (`kty`, `crv`, and `alg`/`use` when present). A token without `kid` is accepted only if exactly one key fits.
- Keys are cached for 10 minutes. An unknown `kid` triggers a reload, so key rotation is picked up. The provider is fetched at most once every 30 seconds (with a 5 second timeout), whether fetches succeed or fail, so random `kid`s or an outage can't hammer it. Concurrent requests share one fetch.
- If a reload fails or returns no keys, the previously fetched keys stay in use, even past the 10 minutes, and the reload is retried at most every 30 seconds. An outage at the provider therefore doesn't take down auth, but a key the provider revokes keeps verifying until a reload succeeds.
- Always set `issuer` and `audience` for third-party tokens; otherwise any token the provider signs for another application is accepted.

### jwtAuth

Middleware that verifies JWT tokens from the Authorization header or cookies.

```typescript
import { jwtAuth } from '@fresho/router/middleware';

jwtAuth({
  // Required: secret key
  secret: 'your-secret-key',
  // Or from environment:
  // secret: (ctx) => ctx.env.JWT_SECRET,

  // Required: map JWT payload to context properties
  claims: (payload) => ({
    user: {
      id: payload.sub,
      email: payload.email,
    },
  }),

  // Optional: allowed algorithms (default: ['HS256'] for HMAC secrets, ['RS256'] otherwise)
  algorithms: ['HS256', 'HS384', 'HS512'],

  // Optional: required iss / aud claims
  issuer: 'my-app',
  audience: 'my-api',

  // Optional: custom token extraction (default: Authorization header or 'token' cookie)
  getToken: (request) => {
    return request.headers.get('X-Auth-Token');
  },
});
```

**Third-party providers:** pass a key set from [`createJwks`](#createjwks) as the secret:

```typescript
const jwks = createJwks('https://example.auth0.com/.well-known/jwks.json');

jwtAuth({
  secret: jwks,
  algorithms: ['RS256'],
  issuer: 'https://example.auth0.com/',
  audience: 'https://api.example.com',
  clockTolerance: 60,
  claims: (payload) => ({ user: { id: payload.sub } }),
});
```

**Token extraction order (default):**
1. `Authorization: Bearer <token>` header
2. `token` cookie

**Rejecting tokens:**

Return `null` from the `claims` function to reject a valid token:

```typescript
claims: (payload) => {
  // Only allow admin users
  if (payload.role !== 'admin') return null;
  return { user: { id: payload.sub } };
},
```

---

## See Also

- [Middleware Documentation](middleware.md)
- [Main Documentation](../README.md)

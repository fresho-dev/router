# Authentication

typed-routes provides flexible authentication support for both token-based and cookie-based auth flows.

## Table of Contents

- [Overview](#overview)
- [Cookie-Based Auth](#cookie-based-auth)
- [Token-Based Auth](#token-based-auth)
- [Token Refresh](#token-refresh)
- [API Reference](#api-reference)
  - [jwtSign](#jwtsign)
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

## Cookie-Based Auth

The simplest approach for web applications. The server sets an httpOnly cookie, and the browser automatically sends it with every request.

### Server

```typescript
import { route, router } from 'typed-routes';
import { jwtAuth, jwtSign } from 'typed-routes/middleware';

const JWT_SECRET = process.env.JWT_SECRET!;

const api = router('/api', {
  // Public: login endpoint sets the cookie
  login: route({
    method: 'post',
    path: '/login',
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

  // Public: logout clears the cookie
  logout: route({
    method: 'post',
    path: '/logout',
    handler: async () => {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        },
      });
    },
  }),

  // Protected: requires valid JWT from cookie or Authorization header
  profile: route.ctx<{ user: { id: string; email: string } }>()({
    method: 'get',
    path: '/profile',
    handler: async (c) => ({
      id: c.user.id,
      email: c.user.email,
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
```

### Client

```typescript
import { createHttpClient } from 'typed-routes';
import { api } from './server.js';

const client = createHttpClient(api);
client.configure({
  baseUrl: 'https://api.example.com',
  credentials: 'include',  // Send cookies with every request
});

// Login - server sets httpOnly cookie
await client.login({
  body: { email: 'alice@example.com', password: 'secret' },
});

// All subsequent requests automatically include the cookie
const profile = await client.profile({});
console.log(profile.email);

// Logout - server clears the cookie
await client.logout({});
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
login: route({
  method: 'post',
  path: '/login',
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
```

### Client

Use dynamic headers to include the token:

```typescript
import { createHttpClient } from 'typed-routes';
import { api } from './server.js';

// Token storage (use your state management in practice)
let token: string | null = null;

const client = createHttpClient(api);
client.configure({
  baseUrl: 'https://api.example.com',
  headers: {
    // Dynamic header - called on each request
    'Authorization': () => token ? `Bearer ${token}` : null,
  },
});

// Login - store token in memory
const result = await client.login({
  body: { email: 'alice@example.com', password: 'secret' },
});
token = result.token;

// Subsequent requests include the Authorization header
const profile = await client.profile({});
```

---

## Token Refresh

To avoid forcing users to re-login when tokens expire, implement a refresh flow.

### Proactive Refresh

Refresh the token before it expires using an async header function:

```typescript
import { jwtSign } from 'typed-routes/middleware';

let token: string | null = null;
let tokenExp: number = 0;

// Parse expiry from JWT (simplified - use a proper JWT decode in production)
function getTokenExp(jwt: string): number {
  const payload = JSON.parse(atob(jwt.split('.')[1]));
  return payload.exp * 1000;
}

client.configure({
  baseUrl: 'https://api.example.com',
  headers: {
    'Authorization': async () => {
      if (!token) return null;

      // Refresh if token expires in < 5 minutes
      if (tokenExp - Date.now() < 5 * 60 * 1000) {
        const result = await client.refresh({});
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
refresh: route.ctx<{ user: { id: string; email: string } }>()({
  method: 'post',
  path: '/refresh',
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
```

---

## API Reference

### jwtSign

Signs a JWT token using Web Crypto API. Compatible with Cloudflare Workers, Deno, and browsers.

```typescript
import { jwtSign } from 'typed-routes/middleware';

const token = await jwtSign(
  { email: 'user@example.com', role: 'admin' },  // Custom claims
  'your-secret-key',                              // Secret
  {
    algorithm: 'HS256',   // HS256, HS384, or HS512 (default: HS256)
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
| `algorithm` | `'HS256' \| 'HS384' \| 'HS512'` | Signing algorithm (default: `'HS256'`) |
| `expiresIn` | `string \| number` | Token lifetime: `'1h'`, `'7d'`, `'30m'`, or seconds |
| `notBefore` | `string \| number` | Token not valid until this time from now |
| `subject` | `string` | `sub` claim (typically user ID) |
| `issuer` | `string` | `iss` claim |
| `audience` | `string \| string[]` | `aud` claim |
| `issuedAt` | `number \| Date` | Custom `iat` (defaults to now) |

**Duration formats:** `'60s'`, `'30m'`, `'1h'`, `'7d'`, `'2w'`

### jwtAuth

Middleware that verifies JWT tokens from the Authorization header or cookies.

```typescript
import { jwtAuth } from 'typed-routes/middleware';

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

  // Optional: allowed algorithms (default: ['HS256'])
  algorithms: ['HS256', 'HS384', 'HS512'],

  // Optional: custom token extraction (default: Authorization header or 'token' cookie)
  getToken: (request) => {
    return request.headers.get('X-Auth-Token');
  },
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

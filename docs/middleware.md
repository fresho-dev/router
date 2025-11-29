# Middleware

typed-routes provides a composable middleware system for request/response processing. Middleware can handle cross-cutting concerns like authentication, logging, CORS, and rate limiting.

## Table of Contents

- [Middleware Basics](#middleware-basics)
- [Authoring Middleware](#authoring-middleware)
  - [Simple Middleware](#simple-middleware)
  - [Typed Environment Access](#typed-environment-access)
  - [Adding Context Properties](#adding-context-properties)
- [Built-in Middleware](#built-in-middleware)
  - [Authentication](#authentication)
    - [basicAuth](#basicauth)
    - [bearerAuth](#bearerauth)
    - [jwtAuth](#jwtauth)
  - [CORS](#cors)
  - [Error Handling](#errorhandler)
  - [Logging](#logger)
  - [Rate Limiting](#ratelimit)
  - [Request ID](#requestid)
  - [Timeout](#timeout)
  - [Content Type Validation](#contenttype)
- [Middleware Utilities](#middleware-utilities)
  - [compose](#compose)
- [Patterns](#patterns)
  - [JWT with Typed Context](#jwt-with-typed-context)
  - [Mixed Public and Protected Routes](#mixed-public-and-protected-routes)
  - [Role-Based Access Control](#role-based-access-control)

---

## Middleware Basics

Middleware functions receive a context and a `next` function. They can:
- Modify the request before it reaches the handler
- Short-circuit the request (return early without calling `next`)
- Modify the response after the handler completes
- Add properties to the context for downstream middleware and handlers

```typescript
import type { Middleware } from 'typed-routes';

const timing: Middleware = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  const ms = Date.now() - start;
  response.headers.set('X-Response-Time', `${ms}ms`);
  return response;
};
```

Add middleware to a router as the third argument:

```typescript
import { router, route } from 'typed-routes';
import { cors, errorHandler } from 'typed-routes/middleware';

const api = router('/api', {
  hello: route({ method: 'get', path: '/hello', handler: async () => ({ message: 'Hello' }) }),
}, [cors(), errorHandler(), timing]);
```

---

## Authoring Middleware

### Simple Middleware

A middleware is a function that takes `(context, next)` and returns a `Response`:

```typescript
import type { Middleware, MiddlewareContext, MiddlewareNext } from 'typed-routes';

const logger: Middleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
  console.log(`${ctx.request.method} ${ctx.request.url}`);
  return next();
};
```

### Typed Context Access

Use `Middleware<Ctx>` to type the context (environment and middleware-added properties):

```typescript
interface AppContext {
  env: {
    JWT_SECRET: string;
    DB: D1Database;
  };
  user?: { id: string };  // Optional - may not exist yet
}

const auth: Middleware<AppContext> = async (ctx, next) => {
  // ctx.env is typed (env.JWT_SECRET, env.DB)
  // Other context properties are Partial (user may be undefined)
  const secret = ctx.env.JWT_SECRET;
  ctx.user = await validateToken(ctx.request, secret);
  return next();
};
```

Note: In middleware, `env` is required but other context properties are `Partial` since middleware may be building them up. In handlers, all context properties are required (middleware has already run).

### Adding Context Properties

Middleware can add properties to the context. These are available to downstream middleware and route handlers:

```typescript
// Middleware adds user to context
const auth: Middleware = async (ctx, next) => {
  ctx.user = await authenticate(ctx.request);
  return next();
};

// Route handler receives the context with user
const profile = route.ctx<{ user: User }>()({
  method: 'get',
  path: '/profile',
  handler: async (c) => {
    // c.user is typed as User
    return { name: c.user.name };
  },
});
```

The `route.ctx<T>()` builder tells TypeScript what context properties the handler expects.

---

## Built-in Middleware

Import from `typed-routes/middleware`:

```typescript
import {
  // Authentication
  basicAuth,
  bearerAuth,
  jwtAuth,
  // CORS
  cors,
  // Utilities
  errorHandler,
  logger,
  rateLimit,
  requestId,
  timeout,
  contentType,
} from 'typed-routes/middleware';
```

---

### Authentication

#### basicAuth

HTTP Basic authentication.

```typescript
basicAuth({
  // Required: verify credentials and return claims to merge into context
  // Return null to reject
  verify: async (username, password, ctx) => {
    if (username === 'admin' && password === 'secret') {
      return { user: { name: username, role: 'admin' } };
    }
    return null;
  },
  // Optional: realm for WWW-Authenticate header (default: "Secure Area")
  realm: 'Admin Area',
})
```

On success, merges the returned claims object into `ctx`.

---

#### bearerAuth

Simple bearer token authentication.

```typescript
bearerAuth({
  // Required: verify token and return claims to merge into context
  // Return null to reject
  verify: async (token, ctx) => {
    if (token === process.env.API_TOKEN) {
      return { token, apiClient: 'trusted' };
    }
    return null;
  },
})
```

On success, merges the returned claims object into `ctx`.

---

#### jwtAuth

JWT authentication with signature verification using Web Crypto API.

```typescript
jwtAuth({
  // Required: secret key (string, ArrayBuffer, or CryptoKey)
  secret: 'your-secret-key',

  // Required: map JWT payload to context properties
  // Return null to reject the token
  claims: (payload) => ({
    user: {
      id: payload.sub,
      email: payload.email,
    },
  }),

  // Optional: allowed algorithms (default: ['HS256'])
  algorithms: ['HS256'],

  // Optional: custom token extractor (default: Authorization header or 'token' cookie)
  getToken: (request) => {
    return request.headers.get('X-Token');
  },
})
```

**Extracting the secret from environment:**

Use the generic parameter for typed access to environment bindings:

```typescript
interface AppContext {
  env: { JWT_SECRET: string };
}

jwtAuth<AppContext>({
  secret: (ctx) => ctx.env.JWT_SECRET,  // ctx.env is typed
  claims: (payload) => ({ user: { id: payload.sub } }),
})
```

**The `claims` function:**

The `claims` function maps the JWT payload to context properties. The returned object is merged into the middleware context using `Object.assign(context, claims)`.

- Return an object with the properties you want in the context
- Return `null` to reject the token (e.g., for role-based filtering)

```typescript
claims: (payload) => {
  // Reject non-admin users
  if (payload.role !== 'admin') return null;

  return {
    user: { id: payload.sub, role: payload.role },
    permissions: payload.permissions,
  };
}
```

**Complete example:**

```typescript
// server.ts
import { route, router } from 'typed-routes';
import { jwtAuth } from 'typed-routes/middleware';

interface User {
  sub: string;
  email: string;
}

export const api = router('/api', {
  profile: route.ctx<{ user: User }>()({
    method: 'get',
    path: '/profile',
    query: { include: 'string?' },
    handler: async (c) => ({
      sub: c.user.sub,
      email: c.user.email,
      include: c.query.include,
    }),
  }),
}, [
  jwtAuth({
    secret: 'your-secret-key',
    claims: (payload) => ({
      user: { sub: payload.sub, email: payload.email },
    }),
  }),
]);

export default { fetch: api.handler() };
```

```typescript
// client.ts
import { createHttpClient } from 'typed-routes';
import { api } from './server.js';

const client = createHttpClient(api);
client.configure({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer eyJhbG...' },
});

// Fully typed: { sub: string, email: string, include: string | undefined }
const profile = await client.profile({ query: { include: 'settings' } });
console.log(profile.email);
```

---

### cors

Cross-Origin Resource Sharing headers.

```typescript
cors({
  // Allowed origins (default: '*')
  // Can be: string, string[], RegExp, or (origin: string) => boolean
  origin: 'https://example.com',
  // or: origin: ['https://example.com', 'https://app.example.com'],
  // or: origin: /\.example\.com$/,
  // or: origin: (origin) => origin.endsWith('.example.com'),

  // Allowed methods (default: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD)
  methods: ['GET', 'POST'],

  // Allowed request headers (default: Content-Type, Authorization)
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Custom-Header'],

  // Headers to expose to the browser
  exposedHeaders: ['X-Total-Count'],

  // Allow credentials (cookies, authorization headers)
  credentials: true,

  // Max age for preflight cache in seconds (default: 86400)
  maxAge: 3600,

  // Pass preflight to next handler instead of returning 204
  preflightContinue: false,
})
```

---

### errorHandler

Catches errors and returns JSON error responses.

```typescript
errorHandler({
  // Custom error logger
  log: (error, ctx) => {
    console.error(`[${ctx.requestId}]`, error);
  },

  // Expose error details in response (default: false)
  // WARNING: Set to false in production
  expose: process.env.NODE_ENV === 'development',

  // Custom error response formatter
  formatter: (error, ctx) => {
    return new Response(JSON.stringify({
      error: error.message,
      requestId: ctx.requestId,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  },
})
```

Supports errors with `status` or `statusCode` properties for custom HTTP status codes.

**Using HttpError:**

Use the `HttpError` class to throw errors with specific status codes:

```typescript
import { route } from 'typed-routes';
import { errorHandler, HttpError } from 'typed-routes/middleware';

const api = router('/api', {
  getUser: route({
    method: 'get',
    path: '/users/:id',
    handler: async (c) => {
      const user = await db.findUser(c.path.id);
      if (!user) throw new HttpError('User not found', 404);
      return user;
    },
  }),
}, [errorHandler()]);
```

This keeps handler return types clean (just `User`, not `User | Response`) while still allowing custom error responses.

---

### logger

Request/response logging.

```typescript
logger({
  // Custom log function (default: console.log)
  log: (message) => myLogger.info(message),

  // Include request headers in log
  includeHeaders: true,

  // Include request body in log
  includeBody: true,

  // Custom log formatter
  formatter: (info) => {
    return `${info.method} ${info.url} ${info.status} ${info.duration}ms`;
  },
})
```

To skip logging for certain paths, use separate routers:

```typescript
// Health check without logging
const healthRouter = router('/health', {
  check: route({ method: 'get', path: '', handler: async () => ({ status: 'ok' }) }),
});

// API routes with logging
const apiRouter = router('/api', routes, logger());

// Combine
const app = router('', { health: healthRouter, api: apiRouter });
```

---

### rateLimit

Rate limiting with configurable store.

```typescript
rateLimit({
  // Time window in milliseconds (default: 60000 = 1 minute)
  windowMs: 60 * 1000,

  // Maximum requests per window (default: 100)
  max: 100,

  // Custom key generator (default: IP address from headers)
  keyGenerator: (ctx) => {
    return ctx.user?.id || getClientIp(ctx.request);
  },

  // Custom store (default: in-memory)
  store: new RedisRateLimitStore(redis),

  // Don't count successful requests (status < 400)
  skipSuccessfulRequests: true,

  // Don't count failed requests (status >= 400)
  skipFailedRequests: true,

  // Custom handler for rate-limited requests
  handler: (ctx) => {
    return new Response(JSON.stringify({ error: 'Slow down!' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  },
})
```

Adds rate limit headers to responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: ISO timestamp when the window resets

---

### requestId

Adds a unique request ID to each request.

```typescript
requestId({
  // Header name (default: 'X-Request-ID')
  headerName: 'X-Request-ID',

  // Custom ID generator (default: crypto.randomUUID())
  generator: () => `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
})
```

Sets `ctx.requestId` and adds the ID to response headers.

---

### timeout

Times out long-running requests.

```typescript
timeout({
  // Timeout in milliseconds (required)
  timeout: 5000,

  // Custom timeout message
  message: 'Request took too long',
})
```

Returns 408 Request Timeout on timeout.

---

### contentType

Validates request Content-Type header.

```typescript
contentType({
  // Required: expected content types
  types: ['application/json', 'application/x-www-form-urlencoded'],

  // Skip validation for these methods (default: GET, HEAD, OPTIONS)
  skipMethods: ['GET', 'HEAD', 'OPTIONS'],

  // Custom error message
  message: 'Only JSON is accepted',
})
```

Returns 415 Unsupported Media Type on mismatch.

---

## Middleware Utilities

### compose

Combines multiple middleware into a single middleware:

```typescript
import { compose } from 'typed-routes/middleware';

const security = compose(
  cors(),
  rateLimit({ max: 100 }),
  errorHandler(),
);

const api = router('/api', routes, security);
```

---

## Patterns

### JWT with Typed Context

Complete example of JWT-protected routes with fully typed context:

```typescript
import { route, router } from 'typed-routes';
import { jwtAuth, cors, errorHandler } from 'typed-routes/middleware';

// 1. Define the User type
interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

// 2. Create the auth middleware with claims mapping
const auth = jwtAuth({
  secret: process.env.JWT_SECRET,
  claims: (payload) => ({
    user: {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    },
  }),
});

// 3. Define routes - use route.ctx<{ user: User }>() for protected endpoints
const api = router('/api', {
  // Protected route with typed user context
  profile: route.ctx<{ user: User }>()({
    method: 'get',
    path: '/profile',
    handler: async (c) => {
      // c.user is typed as User
      return { id: c.user.id, email: c.user.email };
    },
  }),
}, [cors(), errorHandler(), auth]);
```

### Mixed Public and Protected Routes

Use nested routers to apply auth only where needed:

```typescript
// Public routes - no auth
const publicRoutes = router('/public', {
  health: route({
    method: 'get',
    path: '/health',
    handler: async () => ({ status: 'ok' }),
  }),
});

// Protected routes - with auth middleware
const protectedRoutes = router('/admin', {
  dashboard: route.ctx<{ user: User }>()({
    method: 'get',
    path: '/dashboard',
    handler: async (c) => ({ userId: c.user.id }),
  }),
}, [jwtAuth({
  secret: process.env.JWT_SECRET,
  claims: (payload) => ({ user: { id: payload.sub } }),
})]);

// Combine into one API
const api = router('/api', {
  public: publicRoutes,
  admin: protectedRoutes,
});

// Routes:
// GET /api/public/health  - no auth required
// GET /api/admin/dashboard - JWT required
```

### Role-Based Access Control

Use a custom middleware to check roles after JWT authentication:

```typescript
import type { Middleware } from 'typed-routes';

interface AuthContext {
  user: { id: string; role: 'admin' | 'user' };
}

// Middleware that requires admin role
const requireAdmin: Middleware = async (ctx, next) => {
  const user = ctx.user as AuthContext['user'] | undefined;
  if (user?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return next();
};

// Apply to admin-only routes
const adminRoutes = router('/admin', {
  users: route.ctx<AuthContext>()({
    method: 'get',
    path: '/users',
    handler: async (c) => ({ requestedBy: c.user.id }),
  }),
}, [requireAdmin]);

// Main API with JWT auth
const api = router('/api', {
  admin: adminRoutes,
}, [jwtAuth({ ... })]);
```

---

## See Also

- [Main Documentation](../README.md)
- [TypeScript Types](../src/middleware.ts)

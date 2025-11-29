# typed-routes

Type-safe routing for Cloudflare Workers, Deno, Bun, and Node.js. Define routes once, get validated handlers, typed clients, and OpenAPI docs.

**~2KB gzipped. Zero dependencies.**

```typescript
import { route, router } from 'typed-routes';

const api = router('/api', {
  getUser: route({
    method: 'get',
    path: '/users/:id',
    query: { include: 'string?' },
    handler: async (c) => {
      // c.params.path.id   - typed as string
      // c.params.query.include - typed as string | undefined
      return { id: c.params.path.id, name: 'Alice' };
    },
  }),

  createUser: route({
    method: 'post',
    path: '/users',
    body: { name: 'string', email: 'string', age: 'number?' },
    handler: async (c) => {
      // c.params.body.name  - typed as string
      // c.params.body.email - typed as string
      // c.params.body.age   - typed as number | undefined
      return { id: '123', ...c.params.body };
    },
  }),
});

// Cloudflare Worker / Deno / Bun
export default { fetch: api.handler() };
```

## Features

- **Type-safe path params** — `/users/:id` extracts `{ id: string }`
- **Schema validation** — query and body validated at runtime, typed at compile time
- **Nested routers** — compose routes with shared prefixes and middleware
- **Typed HTTP client** — call your API with full type safety
- **Typed local client** — test handlers directly without HTTP
- **OpenAPI generation** — auto-generate docs from your routes
- **Middleware** — cors, auth, rate limiting, and more
- **Streaming** — SSE and JSON lines helpers
- **Zero dependencies** — just Web APIs

## Installation

```bash
npm install typed-routes
```

## Schemas

Define query and body schemas using shorthand syntax:

```typescript
// Primitives
{ name: 'string' }      // required string
{ age: 'number' }       // required number (coerced from string in query)
{ active: 'boolean' }   // required boolean (accepts "true"/"false"/"1"/"0")

// Optional (append ?)
{ name: 'string?' }     // optional string

// Arrays
{ tags: 'string[]' }    // string array
{ scores: 'number[]' }  // number array

// Nested objects
{
  address: {
    street: 'string',
    city: 'string',
    zip: 'number?'
  }
}
```

Types are automatically inferred:

```typescript
const createPost = route({
  method: 'post',
  path: '/posts',
  body: {
    title: 'string',
    tags: 'string[]',
    metadata: { priority: 'number', draft: 'boolean?' }
  },
  handler: async (c) => {
    c.params.body.title      // string
    c.params.body.tags       // string[]
    c.params.body.metadata   // { priority: number, draft: boolean | undefined }
  },
});
```

## Path Parameters

Path parameters are extracted and typed automatically:

```typescript
// Simple
route({ path: '/users/:id', ... })
// c.params.path.id → string

// Multiple
route({ path: '/users/:userId/posts/:postId', ... })
// c.params.path.userId → string
// c.params.path.postId → string

// With extensions
route({ path: '/files/:name.pdf', ... })
// Matches /files/document.pdf
// c.params.path.name → "document"

// Complex patterns
route({ path: '/audio/:artist-:track.mp3', ... })
// Matches /audio/beatles-yesterday.mp3
// c.params.path.artist → "beatles"
// c.params.path.track → "yesterday"
```

## Nested Routers

Compose routers with shared path prefixes and middleware:

```typescript
const users = router('/users', {
  list: route({ method: 'get', path: '/', ... }),
  get: route({ method: 'get', path: '/:id', ... }),
  create: route({ method: 'post', path: '/', ... }),
});

const posts = router('/posts', {
  list: route({ method: 'get', path: '/', ... }),
  get: route({ method: 'get', path: '/:id', ... }),
});

const api = router('/api/v1', { users, posts });

// Routes:
// GET  /api/v1/users
// GET  /api/v1/users/:id
// POST /api/v1/users
// GET  /api/v1/posts
// GET  /api/v1/posts/:id
```

## Middleware

Add middleware to routers:

```typescript
import { router, route } from 'typed-routes';
import { cors, errorHandler, logger } from 'typed-routes/middleware';

const api = router('/api', {
  hello: route({ method: 'get', path: '/hello', handler: ... }),
}, [
  cors(),
  errorHandler(),
  logger(),
]);
```

### Built-in Middleware

```typescript
import {
  cors,           // CORS headers
  errorHandler,   // Catch errors, return JSON
  logger,         // Request logging
  rateLimit,      // Rate limiting
  requestId,      // X-Request-ID header
  timeout,        // Request timeout
  basicAuth,      // Basic authentication
  bearerAuth,     // Bearer token auth
  jwtAuth,        // JWT validation
} from 'typed-routes/middleware';
```

### Custom Middleware

```typescript
import type { Middleware, MiddlewareContext, MiddlewareNext } from 'typed-routes';

const timing: Middleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
  const start = Date.now();
  const response = await next();
  const ms = Date.now() - start;
  response.headers.set('X-Response-Time', `${ms}ms`);
  return response;
};
```

### Typed Middleware Context

Pass typed context from middleware to handlers:

```typescript
interface AuthContext {
  user: { id: string; name: string };
}

const authMiddleware: Middleware = async (ctx, next) => {
  ctx.user = await validateToken(ctx.request.headers.get('Authorization'));
  return next();
};

const api = router('/api', {
  profile: route.ctx<AuthContext>()({
    method: 'get',
    path: '/profile',
    handler: async (c) => {
      // c.user is typed as { id: string; name: string }
      return { name: c.user.name };
    },
  }),
}, [authMiddleware]);
```

## HTTP Client

Generate a typed client for your API:

```typescript
import { route, router, createHttpClient } from 'typed-routes';

// Server
const api = router('/api', {
  getUser: route({
    method: 'get',
    path: '/users/:id',
    query: { include: 'string?' },
    handler: async (c) => ({ id: c.params.path.id, name: 'Alice' }),
  }),
});

// Client
const client = createHttpClient(api);
client.configure({ baseUrl: 'https://api.example.com' });

const user = await client.getUser({
  path: { id: '123' },           // Required - typed from path
  query: { include: 'posts' },   // Optional - typed from schema
});
// user is typed as { id: string, name: string }
```

## Local Client

Test handlers directly without HTTP overhead:

```typescript
import { createLocalClient } from 'typed-routes';

const client = createLocalClient(api);
client.configure({ env: { DB: mockDb } });

const user = await client.getUser({
  path: { id: '123' },
});

assert.equal(user.name, 'Alice');
```

## OpenAPI Generation

Generate OpenAPI 3.0 documentation:

```typescript
import { generateDocs } from 'typed-routes';

const spec = generateDocs(api, {
  title: 'My API',
  version: '1.0.0',
  description: 'API documentation',
});

// Serve at /openapi.json
router('/docs', {
  spec: route({
    method: 'get',
    path: '/openapi.json',
    handler: async () => spec,
  }),
});
```

## Streaming

### Server-Sent Events

```typescript
import { sseResponse } from 'typed-routes';

route({
  method: 'get',
  path: '/events',
  handler: async () => {
    return sseResponse(async function* () {
      yield { data: 'connected' };
      yield { event: 'update', data: { count: 1 } };
      yield { event: 'update', data: { count: 2 }, id: 'msg-2' };
    });
  },
});
```

### JSON Lines

```typescript
import { streamJsonLines } from 'typed-routes';

route({
  method: 'get',
  path: '/logs',
  handler: async () => {
    return streamJsonLines(async function* () {
      yield { level: 'info', message: 'Starting...' };
      yield { level: 'info', message: 'Done' };
    });
  },
});
```

## Cloudflare Workers

```typescript
import { route, router } from 'typed-routes';

const api = router('/api', { ... });

export default {
  fetch: api.handler(),
};
```

### Typed Environment Bindings

Use `route.env<E>()` to type environment bindings:

```typescript
interface Env {
  KV: KVNamespace;
  DB: D1Database;
}

const getData = route.env<Env>()({
  method: 'get',
  path: '/data',
  handler: async (c) => {
    const value = await c.env.KV.get('key'); // c.env is typed!
    return { value };
  },
});
```

### Typed Environment + Middleware Context

Chain with `.ctx<C>()` for both:

```typescript
interface Env {
  DB: D1Database;
}

interface AuthContext {
  user: { id: string };
}

const profile = route.env<Env>().ctx<AuthContext>()({
  method: 'get',
  path: '/profile',
  handler: async (c) => {
    // c.env.DB is typed, c.user is typed
    await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.user.id);
  },
});
```

## Size

| Usage | Minified | Gzipped |
|-------|----------|---------|
| Core (routing + validation) | 4.2 KB | 1.9 KB |
| + HTTP client | 5.8 KB | 2.4 KB |
| + OpenAPI docs | 5.3 KB | 2.3 KB |
| + cors, errorHandler | 6.5 KB | 2.7 KB |
| + all middleware | 11.6 KB | 4.4 KB |

Tree-shakeable: only pay for what you import.

For comparison:
- itty-router: 1.0 KB gzipped (routing only, no validation)
- Hono: ~14 KB gzipped (routing + middleware, no validation)

## License

MIT

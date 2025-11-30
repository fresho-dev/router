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
      // c.path.id       - typed as string
      // c.query.include - typed as string | undefined
      return { id: c.path.id, name: 'Alice' };
    },
  }),

  createUser: route({
    method: 'post',
    path: '/users',
    body: { name: 'string', email: 'string', age: 'number?' },
    handler: async (c) => {
      // c.body.name  - typed as string
      // c.body.email - typed as string
      // c.body.age   - typed as number | undefined
      return { id: '123', ...c.body };
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
- **HTTP-compliant** — automatic HEAD support for GET routes
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
    c.body.title      // string
    c.body.tags       // string[]
    c.body.metadata   // { priority: number, draft: boolean | undefined }
  },
});
```

## Path Parameters

Path parameters are extracted and typed automatically:

```typescript
// Simple
route({ path: '/users/:id', ... })
// c.path.id → string

// Multiple
route({ path: '/users/:userId/posts/:postId', ... })
// c.path.userId → string
// c.path.postId → string

// With extensions
route({ path: '/files/:name.pdf', ... })
// Matches /files/document.pdf
// c.path.name → "document"

// Complex patterns
route({ path: '/audio/:artist-:track.mp3', ... })
// Matches /audio/beatles-yesterday.mp3
// c.path.artist → "beatles"
// c.path.track → "yesterday"
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
import { cors, errorHandler, jwtAuth } from 'typed-routes/middleware';

const api = router('/api', {
  hello: route({ method: 'get', path: '/hello', handler: ... }),
},
  cors(),
  errorHandler(),
  jwtAuth({ secret: process.env.JWT_SECRET, claims: (p) => ({ user: p.sub }) }),
);
```

Built-in middleware: `cors`, `errorHandler`, `logger`, `rateLimit`, `requestId`, `timeout`, `basicAuth`, `bearerAuth`, `jwtAuth`, `contentType`.

See **[Middleware Documentation](docs/middleware.md)** for detailed usage, custom middleware authoring, and patterns.

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
    handler: async (c) => ({ id: c.path.id, name: 'Alice' }),
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
    return sseResponse(async (send, close) => {
      send({ data: 'connected' });
      send({ event: 'update', data: { count: 1 } });
      send({ event: 'update', data: { count: 2 }, id: 'msg-2' });
      close();
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
    return streamJsonLines(async (send, close) => {
      send({ level: 'info', message: 'Starting...' });
      send({ level: 'info', message: 'Done' });
      close();
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

### Typed Context

Use `route.ctx<Ctx>()` to type environment bindings and middleware-added properties:

```typescript
interface AppContext {
  env: {
    KV: KVNamespace;
    DB: D1Database;
  };
  user: { id: string };  // Added by auth middleware
}

const profile = route.ctx<AppContext>()({
  method: 'get',
  path: '/profile',
  handler: async (c) => {
    // c.env.KV, c.env.DB are typed
    // c.user is typed (from middleware)
    const data = await c.env.KV.get('key');
    return { userId: c.user.id, data };
  },
});
```

Chain multiple `.ctx<>()` calls to compose context types:

```typescript
interface EnvBindings { env: { DB: D1Database } }
interface AuthContext { user: { id: string } }

// Compose contexts inline - no need to pre-define combined interface
const data = route.ctx<EnvBindings>().ctx<AuthContext>()({
  method: 'get',
  path: '/data',
  handler: async (c) => {
    c.env.DB;  // typed from EnvBindings
    c.user.id; // typed from AuthContext
    return { userId: c.user.id };
  },
});
```

## Common Patterns

For detailed middleware patterns including JWT authentication, role-based access control, and mixed public/protected routes, see the **[Middleware Documentation](docs/middleware.md#patterns)**.

### Cloudflare Workers with D1

Combine environment bindings with typed context:

```typescript
import { route, router } from 'typed-routes';
import { jwtAuth } from 'typed-routes/middleware';

interface AppContext {
  env: {
    DB: D1Database;
    JWT_SECRET: string;
  };
  user: {
    id: string;
    email: string;
  };
}

const api = router('/api', {
  users: route.ctx<AppContext>()({
    method: 'get',
    path: '/users',
    handler: async (c) => {
      // c.env.DB is typed as D1Database
      // c.user is typed
      const { results } = await c.env.DB.prepare('SELECT * FROM users').all();
      return { users: results, requestedBy: c.user.id };
    },
  }),
},
  jwtAuth<AppContext>({
    secret: (ctx) => ctx.env.JWT_SECRET,  // ctx.env is typed
    claims: (payload) => ({
      user: { id: payload.sub, email: payload.email },
    }),
  }),
);

export default { fetch: api.handler() };
```

### Testing with Local Client

Test routes directly without HTTP:

```typescript
import { createLocalClient } from 'typed-routes';
import { api } from './server.js';

const client = createLocalClient(api);
client.configure({ env: { DB: mockDb } });

const result = await client.users();
assert.ok(result.users);
```

## HEAD Requests

Per [RFC 9110](https://httpwg.org/specs/rfc9110.html#HEAD), HEAD requests are automatically handled for any GET route. The GET handler runs and the response body is stripped.

```typescript
const api = router('/api', {
  users: route({
    method: 'get',
    path: '/users',
    handler: async () => {
      const users = await db.getUsers(); // This runs for both GET and HEAD
      return { users };
    },
  }),
});

// GET /api/users  → 200 with body: {"users":[...]}
// HEAD /api/users → 200 with no body (same headers)
```

> **Performance note:** The handler executes fully for HEAD requests, same as GET. This matches the behavior of Express, Django, Flask, and Hono. If your handler has expensive operations you want to skip for HEAD requests, check the request method:
>
> ```typescript
> handler: async (c) => {
>   if (c.request.method === 'HEAD') {
>     // Return early with just headers
>     return new Response(null, {
>       headers: { 'X-Total-Count': '1000' },
>     });
>   }
>   // Full processing for GET
>   const users = await db.getUsers();
>   return { users };
> }
> ```

If you need different behavior for HEAD, define an explicit HEAD route before the GET route:

```typescript
const api = router('/api', {
  usersHead: route({
    method: 'head',
    path: '/users',
    handler: async () => new Response(null, { status: 200 }),
  }),
  usersGet: route({
    method: 'get',
    path: '/users',
    handler: async () => ({ users: await db.getUsers() }),
  }),
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

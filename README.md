# typed-routes

Type-safe routing for Cloudflare Workers, Deno, Bun, and Node.js. Define routes once, get validated handlers, typed clients, and OpenAPI docs.

**~2KB gzipped. Zero dependencies.**

```typescript
import { route, router } from "typed-routes";

const api = router({
	health: router({
		get: async () => ({ status: "ok" }),
	}),

	users: router({
		// GET /users - list with optional limit
		get: route({
			query: { limit: "number?" },
			handler: async (c) => db.users.list(c.query.limit),
		}),

		// POST /users - create user
		post: route({
			body: { name: "string", email: "string" },
			handler: async (c) => db.users.create(c.body),
		}),

		// GET /users/:id - get by id
		$id: router({
			// Bare function shorthand instead of `route` type
			get: async (c) => db.users.get(c.path.id),
		}),
	}),
});

// Cloudflare Worker / Deno / Bun
export default { fetch: api.handler() };
```

## Features

- **Type-safe path params** — `$id` creates dynamic segments, typed via `route.ctx<>()`
- **Schema validation** — query and body validated at runtime, typed at compile time
- **Property-based routing** — property names become URL segments
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

## Path Convention

Property names become URL path segments:

```typescript
router({
  api: router({           // /api
    users: router({       // /api/users
      get: async () => ...,
      $id: router({       // /api/users/:id
        get: async (c) => c.path.id,
      }),
    }),
  }),
});
```

- Regular properties → static segments (`users` → `/users`)
- `$param` properties → dynamic segments (`$id` → `/:id`)
- HTTP methods (`get`, `post`, etc.) → handlers at that path

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
post: route({
	body: {
		title: "string",
		tags: "string[]",
		metadata: { priority: "number", draft: "boolean?" },
	},
	handler: async (c) => {
		c.body.title; // string
		c.body.tags; // string[]
		c.body.metadata; // { priority: number, draft: boolean | undefined }
	},
});
```

## Typing Best Practices

**Schemas** (`query`/`body`) provide runtime validation AND type inference:

```typescript
get: route({
	query: { limit: "number?" },
	handler: async (c) => c.query.limit, // number | undefined
});
```

**Context** (`route.ctx<T>()`) provides types only for things schemas don't cover:

```typescript
interface MyContext {
	path: { id: string }; // from $id segment
	env: { DB: Database }; // runtime environment
	user: { name: string }; // from auth middleware
}

get: route.ctx<MyContext>()({
	query: { include: "string?" }, // validated
	handler: async (c) => ({
		id: c.path.id, // from context
		user: c.user.name, // from context
		include: c.query.include, // from schema
	}),
});
```

**Don't add explicit type annotations to handlers** — let types flow from schemas and context:

```typescript
// GOOD: types inferred
handler: async (c) => c.query.limit;

// BAD: redundant annotation
handler: async (c: { query: { limit?: number } }) => c.query.limit;
```

## Nested Routers

Compose routers:

```typescript
const users = router({
  get: async () => db.users.list(),
  post: route({
    body: { name: 'string' },
    handler: async (c) => db.users.create(c.body),
  }),
  $id: router({
    get: async (c) => db.users.get(c.path.id),
    delete: async (c) => db.users.delete(c.path.id),
  }),
});

const api = router({
  users,
  posts: router({ ... }),
});

// Routes:
// GET    /users
// POST   /users
// GET    /users/:id
// DELETE /users/:id
```

## Middleware

Add middleware to routers:

```typescript
import { router, route } from "typed-routes";
import { cors, errorHandler, jwtAuth } from "typed-routes/middleware";

const api = router(
	{
		hello: router({
			get: async () => ({ message: "world" }),
		}),
	},
	cors(),
	errorHandler(),
	jwtAuth({ secret: process.env.JWT_SECRET, claims: (p) => ({ user: p.sub }) })
);
```

Built-in middleware: `cors`, `errorHandler`, `logger`, `rateLimit`, `requestId`, `timeout`, `basicAuth`, `bearerAuth`, `jwtAuth`, `contentType`.

See **[Middleware Documentation](docs/middleware.md)** for detailed usage.

## HTTP Client

Generate a typed client for your API:

```typescript
// === Server (api.ts) ===
import { route, router } from "typed-routes";

export const api = router({
	users: router({
		get: route({
			query: { limit: "number?" },
			handler: async (c) => ({ users: [], limit: c.query.limit }),
		}),
		$id: router({
			get: async (c) => ({ id: c.path.id, name: "Alice" }),
		}),
	}),
});

// === Client ===
import { createHttpClient } from "typed-routes";
import type { api } from "./api"; // Type-only import!

const client = createHttpClient<typeof api>({
	baseUrl: "https://api.example.com",
});

// Direct call for GET routes
const users = await client.users({ query: { limit: 10 } });

// Path params
const user = await client.users.$id({ path: { id: "123" } });
// user is typed as { id: string, name: string }

// Explicit methods for non-GET
await client.users.post({ body: { name: "Bob" } });
```

## Local Client

Test handlers directly without HTTP overhead:

```typescript
import { createLocalClient } from "typed-routes";

const client = createLocalClient(api);
client.configure({ env: { DB: mockDb } });

const user = await client.users.$id({ path: { id: "123" } });
assert.equal(user.name, "Alice");
```

## OpenAPI Generation

Generate OpenAPI 3.0 documentation:

```typescript
import { generateDocs } from "typed-routes";

const spec = generateDocs(api, {
	title: "My API",
	version: "1.0.0",
});

// Serve at /openapi.json
const docs = router({
	openapi: router({
		get: async () => spec,
	}),
});
```

## Streaming

### Server-Sent Events

```typescript
import { sseResponse } from "typed-routes";

events: router({
	get: async () =>
		sseResponse(async (send, close) => {
			send({ data: "connected" });
			send({ event: "update", data: { count: 1 } });
			close();
		}),
});
```

### JSON Lines

```typescript
import { streamJsonLines } from "typed-routes";

logs: router({
	get: async () =>
		streamJsonLines(async (send, close) => {
			send({ level: "info", message: "Starting..." });
			send({ level: "info", message: "Done" });
			close();
		}),
});
```

## Cloudflare Workers

```typescript
import { route, router } from 'typed-routes';

const api = router({ ... });

export default {
  fetch: api.handler(),
};
```

### Typed Context

Use `route.ctx<T>()` for environment bindings and middleware-added properties:

```typescript
interface AppContext {
	env: { DB: D1Database };
	user: { id: string }; // from auth middleware
}

const api = router(
	{
		profile: router({
			get: route.ctx<AppContext>()({
				handler: async (c) => {
					const data = await c.env.DB.prepare("...").all();
					return { userId: c.user.id, data };
				},
			}),
		}),
	},
	jwtAuth({
		secret: (c) => c.env.JWT_SECRET,
		claims: (p) => ({ user: { id: p.sub } }),
	})
);

export default { fetch: api.handler() };
```

## HEAD Requests

Per [RFC 9110](https://httpwg.org/specs/rfc9110.html#HEAD), HEAD requests are automatically handled for any GET route:

```typescript
users: router({
	get: async () => ({ users: await db.getUsers() }),
});

// GET /users  → 200 with body
// HEAD /users → 200 with no body (same headers)
```

Define an explicit `head` handler if you need different behavior:

```typescript
users: router({
	head: async () => new Response(null, { headers: { "X-Count": "100" } }),
	get: async () => ({ users: await db.getUsers() }),
});
```

## Size

| Usage                       | Minified | Gzipped |
| --------------------------- | -------- | ------- |
| Core (routing + validation) | 4.2 KB   | 1.9 KB  |
| + HTTP client               | 5.8 KB   | 2.4 KB  |
| + OpenAPI docs              | 5.3 KB   | 2.3 KB  |
| + cors, errorHandler        | 6.5 KB   | 2.7 KB  |
| + all middleware            | 11.6 KB  | 4.4 KB  |

Tree-shakeable: only pay for what you import.

## License

MIT

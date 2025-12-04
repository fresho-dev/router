# @fresho/router example

A todo API demonstrating @fresho/router across different platforms.

## Setup

```bash
npm install
```

## Structure

```
example/
├── server.ts        # API definition with handlers, exports typed client
├── server.test.ts   # Tests using localClient (no HTTP)
├── client.ts        # HTTP client usage example
├── worker.ts        # Cloudflare Workers entrypoint
├── deno.ts          # Deno entrypoint
└── node.ts          # Node.js entrypoint
```

## Running

### Node.js

```bash
npm start
```

### Deno

```bash
deno run --allow-net deno.ts
```

### Cloudflare Workers

```bash
wrangler deploy worker.ts
```

## Testing

Tests use `localClient` to call handlers directly without HTTP:

```bash
npm test
```

## Client Demo

Start the server, then run the client:

```bash
# Terminal 1
npm start

# Terminal 2
npm run client
```

## Type Checking

```bash
npm run typecheck
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/todos` | List todos (`?completed=true/false`) |
| GET | `/api/todos/:id` | Get todo by ID |
| POST | `/api/todos` | Create todo (`{ "title": "..." }`) |
| PATCH | `/api/todos/:id` | Update todo |
| DELETE | `/api/todos/:id` | Delete todo |

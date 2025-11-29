import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer, type Server } from 'node:http';
import { route, router, createHttpClient, createLocalClient } from './index.js';
import { createHandler } from './handler.js';

describe('integration tests', () => {
  // Define routes for testing.
  // Handlers return plain objects (auto-wrapped in Response.json) for type inference.
  const api = router('/api', {
    health: route({
      method: 'get',
      path: '/health',
      handler: async () => ({ status: 'ok' }),
    }),

    echo: route({
      method: 'get',
      path: '/echo',
      query: { message: 'string' },
      handler: async (c) => ({ message: c.query.message }),
    }),

    users: router('/users', {
      list: route({
        method: 'get',
        path: '',
        query: { limit: 'number?' },
        handler: async (c) => {
          const limit = c.query.limit ?? 10;
          const users = Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
          return { users };
        },
      }),

      create: route({
        method: 'post',
        path: '',
        body: { name: 'string', email: 'string' },
        handler: async (c) => ({ id: 1, name: c.body.name, email: c.body.email }),
      }),
    }),
  });

  // Create standalone handler.
  const handler = createHandler(api);

  let server: Server;
  let port: number;

  before(async () => {
    // Create Node HTTP server using standalone handler.
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // Build Request from Node's IncomingMessage.
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }

      const body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => resolve(data));
      });

      const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? body : undefined,
      });

      // Call handler and write response.
      const response = await handler(request);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));

      const responseBody = await response.text();
      res.end(responseBody);
    });

    // Start server on random available port.
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          port = address.port;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('httpClient over real HTTP', () => {
    it('fetches health endpoint', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      const result = (await client.health()) as { status: string };
      assert.strictEqual(result.status, 'ok');
    });

    it('passes query parameters', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      const result = (await client.echo({ query: { message: 'hello world' } })) as { message: string };
      assert.strictEqual(result.message, 'hello world');
    });

    it('handles nested router paths', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      const result = (await client.users.list()) as { users: Array<{ id: number; name: string }> };
      assert.strictEqual(result.users.length, 10);
      assert.strictEqual(result.users[0].name, 'User 1');
    });

    it('passes optional query parameters', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      const result = (await client.users.list({ query: { limit: 3 } })) as {
        users: Array<{ id: number; name: string }>;
      };
      assert.strictEqual(result.users.length, 3);
    });

    it('sends POST body', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      const result = (await client.users.create({
        body: { name: 'Alice', email: 'alice@example.com' },
      })) as { id: number; name: string; email: string };

      assert.strictEqual(result.name, 'Alice');
      assert.strictEqual(result.email, 'alice@example.com');
    });

    it('handles validation errors', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      await assert.rejects(async () => client.echo(), /Invalid query parameters|400/);
    });

    it('handles body validation errors', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      await assert.rejects(
        async () => client.users.create({ body: { name: 'Alice' } as never }),
        /Invalid request body|400/
      );
    });

    it('returns 404 for unknown routes', async () => {
      const client = createHttpClient(api);
      client.configure({ baseUrl: `http://localhost:${port}` });

      await assert.rejects(async () => {
        const response = await fetch(`http://localhost:${port}/unknown`);
        if (!response.ok) throw new Error(`${response.status}`);
      }, /404/);
    });
  });

  describe('localClient matches httpClient behavior', () => {
    it('returns same result as httpClient for simple GET', async () => {
      const http = createHttpClient(api);
      http.configure({ baseUrl: `http://localhost:${port}` });

      const local = createLocalClient(api);

      const httpResult = await http.health();
      const localResult = await local.health();

      assert.deepStrictEqual(httpResult, localResult);
    });

    it('returns same result as httpClient for GET with query', async () => {
      const http = createHttpClient(api);
      http.configure({ baseUrl: `http://localhost:${port}` });

      const local = createLocalClient(api);

      const httpResult = await http.echo({ query: { message: 'test' } });
      const localResult = await local.echo({ query: { message: 'test' } });

      assert.deepStrictEqual(httpResult, localResult);
    });

    it('returns same result as httpClient for nested routes', async () => {
      const http = createHttpClient(api);
      http.configure({ baseUrl: `http://localhost:${port}` });

      const local = createLocalClient(api);

      const httpResult = await http.users.list({ query: { limit: 5 } });
      const localResult = await local.users.list({ query: { limit: 5 } });

      assert.deepStrictEqual(httpResult, localResult);
    });

    it('returns same result as httpClient for POST', async () => {
      const http = createHttpClient(api);
      http.configure({ baseUrl: `http://localhost:${port}` });

      const local = createLocalClient(api);

      const body = { name: 'Bob', email: 'bob@example.com' };

      const httpResult = await http.users.create({ body });
      const localResult = await local.users.create({ body });

      assert.deepStrictEqual(httpResult, localResult);
    });
  });
});

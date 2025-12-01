import { describe, it } from 'node:test';
import assert from 'node:assert';
import { route, router, createLocalClient } from './index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

describe('integration tests', () => {
  // Define routes for testing.
  const api = router({
    health: router({
      get: async () => ({ status: 'ok' }),
    }),

    echo: router({
      get: route({
        query: { message: 'string' },
        handler: async (c) => ({ message: c.query.message }),
      }),
    }),

    users: router({
      get: route({
        query: { limit: 'number?' },
        handler: async (c) => {
          const limit = c.query.limit ?? 10;
          const users = Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
          return { users };
        },
      }),

      post: route({
        body: { name: 'string', email: 'string' },
        handler: async (c) => ({ id: 1, name: c.body.name, email: c.body.email }),
      }),
    }),
  });

  describe('localClient integration', () => {
    it('fetches health endpoint', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.health();
      assert.strictEqual((result as { status: string }).status, 'ok');
    });

    it('passes query parameters', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.echo({ query: { message: 'hello world' } });
      assert.strictEqual((result as { message: string }).message, 'hello world');
    });

    it('handles nested router paths', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.users();
      const typed = result as { users: Array<{ id: number; name: string }> };
      assert.strictEqual(typed.users.length, 10);
      assert.strictEqual(typed.users[0].name, 'User 1');
    });

    it('passes optional query parameters', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.users({ query: { limit: 3 } });
      const typed = result as { users: Array<{ id: number; name: string }> };
      assert.strictEqual(typed.users.length, 3);
    });

    it('sends POST body', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.users.post({
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      const typed = result as { id: number; name: string; email: string };
      assert.strictEqual(typed.name, 'Alice');
      assert.strictEqual(typed.email, 'alice@example.com');
    });

    it('handles validation errors', async () => {
      const client: AnyClient = createLocalClient(api);
      await assert.rejects(async () => client.echo(), /Invalid query parameters/);
    });

    it('handles body validation errors', async () => {
      const client: AnyClient = createLocalClient(api);
      await assert.rejects(
        async () => client.users.post({ body: { name: 'Alice' } as never }),
        /Invalid request body/
      );
    });
  });

  describe('localClient direct call vs explicit method', () => {
    it('direct call works for GET routes', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.health();
      assert.strictEqual((result as { status: string }).status, 'ok');
    });

    it('.get() works for GET routes', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.health.get();
      assert.strictEqual((result as { status: string }).status, 'ok');
    });

    it('.post() works for POST routes', async () => {
      const client: AnyClient = createLocalClient(api);
      const result = await client.users.post({
        body: { name: 'Bob', email: 'bob@example.com' },
      });
      assert.strictEqual((result as { name: string }).name, 'Bob');
    });
  });
});

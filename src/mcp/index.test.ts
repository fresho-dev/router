/**
 * @fileoverview Tests for the MCP server adapter.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { route, router } from '../index.js';
import { bearerAuth } from '../middleware/index.js';
import { mcp, oauthProtectedResource } from './index.js';

const auth = bearerAuth({ verify: (token) => (token === 'good' ? { uid: 'u1' } : null) });

const users = router(
  {
    get: route({
      description: 'List users',
      query: { limit: 'number?' },
      handler: async (c) => ({ limit: c.query.limit ?? 10 }),
    }),
    post: route({
      description: 'Create a user',
      body: { name: 'string', address: { city: 'string' }, tags: 'string[]?' },
      handler: async (c) => c.body,
    }),
    $id: router({
      get: async (c) => ({ id: c.path.id, uid: (c as unknown as { uid: string }).uid }),
      delete: async () => new Response('gone', { status: 404 }),
    }),
  },
  auth,
);

const app = router({
  users,
  mcp: mcp({ users }, { name: 'test', version: '1.0.0', instructions: 'Use the tools.' }),
  secure: router({
    mcp: mcp(
      { users },
      {
        name: 'test',
        version: '1.0.0',
        oauth: { authorizationServers: ['https://auth.example.com'], scopes: ['users:read'] },
      },
      auth,
    ),
  }),
  '.well-known': oauthProtectedResource({ authorizationServers: ['https://auth.example.com'] }),
});

const fetchApp = app.handler();

async function connect(path = '/mcp', token: string | null = 'good') {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost${path}`), {
    fetch: async (url, init) => fetchApp(new Request(url, init)),
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

const text = (result: Record<string, unknown>) =>
  (result.content as { type: string; text: string }[])[0].text;

describe('mcp', () => {
  it('lists one tool per route with JSON schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    assert.deepStrictEqual(
      tools.map((t) => t.name),
      ['get_users', 'post_users', 'get_users_by_id', 'delete_users_by_id'],
    );
    assert.strictEqual(tools[0].description, 'List users');
    assert.strictEqual(tools[2].description, 'GET /users/{id}');
    assert.deepStrictEqual(tools[0].inputSchema, {
      type: 'object',
      properties: {
        query: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
      },
      required: [],
    });
    assert.deepStrictEqual(tools[1].inputSchema, {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'address'],
        },
      },
      required: ['body'],
    });
    assert.deepStrictEqual(tools[3].inputSchema, {
      type: 'object',
      properties: {
        path: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
      required: ['path'],
    });
  });

  it('passes instructions and server info', async () => {
    const client = await connect();
    assert.strictEqual(client.getInstructions(), 'Use the tools.');
    assert.deepStrictEqual(client.getServerVersion(), { name: 'test', version: '1.0.0' });
  });

  it('calls routes with query, body and path arguments', async () => {
    const client = await connect();

    const list = await client.callTool({ name: 'get_users', arguments: { query: { limit: 5 } } });
    assert.strictEqual(list.isError, false);
    assert.deepStrictEqual(JSON.parse(text(list)), { limit: 5 });

    const body = { name: 'Ada', address: { city: 'London' }, tags: ['x'] };
    const created = await client.callTool({ name: 'post_users', arguments: { body } });
    assert.deepStrictEqual(JSON.parse(text(created)), body);

    const one = await client.callTool({
      name: 'get_users_by_id',
      arguments: { path: { id: 'a/b' } },
    });
    assert.deepStrictEqual(JSON.parse(text(one)), { id: 'a/b', uid: 'u1' });
  });

  it('reports validation and HTTP errors as tool errors', async () => {
    const client = await connect();

    const invalid = await client.callTool({ name: 'post_users', arguments: { body: {} } });
    assert.strictEqual(invalid.isError, true);
    assert.match(text(invalid), /Invalid request body/);

    const missing = await client.callTool({ name: 'get_users_by_id', arguments: {} });
    assert.strictEqual(missing.isError, true);
    assert.match(text(missing), /Missing path parameter: id/);

    const gone = await client.callTool({
      name: 'delete_users_by_id',
      arguments: { path: { id: '1' } },
    });
    assert.strictEqual(gone.isError, true);
    assert.strictEqual(text(gone), 'gone');
  });

  it('rejects unknown tools', async () => {
    const client = await connect();
    await assert.rejects(() => client.callTool({ name: 'nope', arguments: {} }), /Unknown tool/);
  });

  it('runs route middleware with the forwarded Authorization header', async () => {
    const client = await connect('/mcp', 'bad');
    const result = await client.callTool({ name: 'get_users', arguments: {} });
    assert.strictEqual(result.isError, true);
    assert.match(text(result), /Invalid token/);
  });

  it('only accepts POST', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await fetchApp(new Request('http://localhost/mcp', { method }));
      assert.strictEqual(response.status, 405);
      assert.strictEqual(response.headers.get('Allow'), 'POST');
    }
  });

  it('throws on duplicate tool names', () => {
    const handler = async () => ({});
    assert.throws(
      () =>
        mcp(
          { a: router({ by_id: router({ get: handler }), $id: router({ get: handler }) }) },
          { name: 'x', version: '1' },
        ),
      /Duplicate tool name: get_a_by_id/,
    );
  });

  describe('oauth', () => {
    const metadataUrl = 'http://localhost/secure/mcp/.well-known/oauth-protected-resource';

    it('challenges unauthenticated requests with resource metadata', async () => {
      const response = await fetchApp(
        new Request('http://localhost/secure/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        }),
      );
      assert.strictEqual(response.status, 401);
      assert.strictEqual(
        response.headers.get('WWW-Authenticate'),
        `Bearer resource_metadata="${metadataUrl}", scope="users:read"`,
      );
    });

    it('keeps the middleware challenge details', async () => {
      const response = await fetchApp(
        new Request('http://localhost/secure/mcp', {
          method: 'POST',
          headers: { Authorization: 'Bearer bad' },
        }),
      );
      assert.strictEqual(
        response.headers.get('WWW-Authenticate'),
        `Bearer error="invalid_token", resource_metadata="${metadataUrl}", scope="users:read"`,
      );
    });

    it('serves tools once authenticated', async () => {
      const client = await connect('/secure/mcp');
      const { tools } = await client.listTools();
      assert.strictEqual(tools.length, 4);
    });

    it('serves protected resource metadata without authentication', async () => {
      const response = await fetchApp(new Request(metadataUrl));
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), {
        resource: 'http://localhost/secure/mcp',
        authorization_servers: ['https://auth.example.com'],
        scopes_supported: ['users:read'],
        bearer_methods_supported: ['header'],
      });
    });

    it('serves metadata at the origin root for a mounted resource', async () => {
      const response = await fetchApp(
        new Request('http://localhost/.well-known/oauth-protected-resource/mcp'),
      );
      assert.deepStrictEqual(await response.json(), {
        resource: 'http://localhost/mcp',
        authorization_servers: ['https://auth.example.com'],
        bearer_methods_supported: ['header'],
      });
    });
  });
});

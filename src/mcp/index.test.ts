/**
 * @fileoverview Tests for the MCP server adapter.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { route, router } from '../index.js';
import { bearerAuth, jwtAuth, jwtSign } from '../middleware/index.js';
import { mcp, oauthProtectedResource } from './index.js';

const auth = bearerAuth({ verify: (token) => (token === 'good' ? { uid: 'u1' } : null) });

const users = router(
  {
    get: route({
      description: 'List users',
      query: { limit: ['number?', 'Max results'] },
      handler: async (c) => ({ limit: c.query.limit ?? 10 }),
    }),
    post: route({
      description: 'Create a user',
      operationId: 'create_user',
      body: {
        name: ['string', 'Full name'],
        address: { city: ['string', 'City of residence'] },
        tags: 'string[]?',
      },
      mcp: { annotations: { destructiveHint: false } },
      handler: async (c) => c.body,
    }),
    $id: router({
      get: async (c) => ({ id: c.path.id, uid: (c as unknown as { uid: string }).uid }),
      delete: async () => new Response('gone', { status: 404 }),
      notes: router({ post: async (c) => c.request.json() }),
    }),
  },
  auth,
);

const app = router({
  users,
  mcp: mcp(
    { users },
    {
      name: 'test',
      version: '1.0.0',
      title: 'Test API',
      icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png', sizes: ['192x192'] }],
      websiteUrl: 'https://example.com',
      instructions: 'Use the tools.',
      public: true,
    },
  ),
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
  it('lists one tool per route with flat JSON schemas', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    assert.deepStrictEqual(
      tools.map((t) => t.name),
      [
        'get_users',
        'create_user',
        'get_users_by_id',
        'delete_users_by_id',
        'post_users_by_id_notes',
      ],
    );
    assert.strictEqual(tools[0].description, 'List users');
    assert.strictEqual(tools[2].description, 'GET /users/{id}');
    assert.deepStrictEqual(tools[0].inputSchema, {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results' } },
    });
    assert.deepStrictEqual(tools[1].inputSchema, {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name' },
        address: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City of residence' } },
          required: ['city'],
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'address'],
    });
    assert.deepStrictEqual(tools[3].inputSchema, {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
  });

  it('sets annotations from the method, with route overrides', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    assert.deepStrictEqual(
      tools.map((t) => t.annotations),
      [
        { readOnlyHint: true },
        { destructiveHint: false },
        { readOnlyHint: true },
        { destructiveHint: true, idempotentHint: true },
        {},
      ],
    );
  });

  it('passes instructions and server info', async () => {
    const client = await connect();
    assert.strictEqual(client.getInstructions(), 'Use the tools.');
    assert.deepStrictEqual(client.getServerVersion(), {
      name: 'test',
      version: '1.0.0',
      title: 'Test API',
      icons: [{ src: 'https://example.com/icon.png', mimeType: 'image/png', sizes: ['192x192'] }],
      websiteUrl: 'https://example.com',
    });
  });

  it('calls routes with query, body and path arguments', async () => {
    const client = await connect();

    const list = await client.callTool({ name: 'get_users', arguments: { limit: 5 } });
    assert.strictEqual(list.isError, false);
    assert.deepStrictEqual(JSON.parse(text(list)), { limit: 5 });
    assert.deepStrictEqual(list.structuredContent, { limit: 5 });

    const body = { name: 'Ada', address: { city: 'London' }, tags: ['x'] };
    const created = await client.callTool({ name: 'create_user', arguments: body });
    assert.deepStrictEqual(JSON.parse(text(created)), body);

    const withNullOptional = await client.callTool({
      name: 'create_user',
      arguments: { name: 'Ada', address: { city: 'London' }, tags: null },
    });
    assert.strictEqual(withNullOptional.isError, false);
    assert.deepStrictEqual(JSON.parse(text(withNullOptional)), {
      name: 'Ada',
      address: { city: 'London' },
    });

    const one = await client.callTool({ name: 'get_users_by_id', arguments: { id: 'a/b' } });
    assert.deepStrictEqual(JSON.parse(text(one)), { id: 'a/b', uid: 'u1' });

    // Without a body schema, arguments that aren't path params become the body.
    const note = await client.callTool({
      name: 'post_users_by_id_notes',
      arguments: { id: '1', text: 'hi' },
    });
    assert.deepStrictEqual(JSON.parse(text(note)), { text: 'hi' });
  });

  it('reports validation and HTTP errors as tool errors', async () => {
    const client = await connect();

    const invalid = await client.callTool({ name: 'create_user', arguments: {} });
    assert.strictEqual(invalid.isError, true);
    assert.match(text(invalid), /Invalid request body/);

    const nullRequired = await client.callTool({
      name: 'create_user',
      arguments: { name: null, address: { city: 'London' } },
    });
    assert.strictEqual(nullRequired.isError, true);
    assert.match(text(nullRequired), /Invalid request body/);

    const missing = await client.callTool({ name: 'get_users_by_id', arguments: {} });
    assert.strictEqual(missing.isError, true);
    assert.match(text(missing), /Missing path parameter: id/);

    const gone = await client.callTool({
      name: 'delete_users_by_id',
      arguments: { id: '1' },
    });
    assert.strictEqual(gone.isError, true);
    assert.strictEqual(text(gone), 'gone');
    assert.strictEqual(gone.structuredContent, undefined);
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
          { name: 'x', version: '1', public: true },
        ),
      /Duplicate tool name: get_a_by_id/,
    );
    const named = (operationId: string) =>
      router({ get: route({ operationId, handler }), b: router({ get: handler }) });
    assert.throws(
      () => mcp({ a: named('get_a_b') }, { name: 'x', version: '1', public: true }),
      /Duplicate tool name: get_a_b/,
    );
  });

  it('rejects invalid operationIds', () => {
    const handler = async () => ({});
    for (const operationId of ['has space', 'x'.repeat(129), '']) {
      assert.throws(
        () =>
          mcp(
            { a: router({ get: route({ operationId, handler }) }) },
            { name: 'x', version: '1', public: true },
          ),
        /Invalid tool name/,
      );
    }
  });

  it('rejects arguments with the same name in several sources', () => {
    const handler = async () => ({});
    assert.throws(
      () =>
        mcp(
          { a: router({ $id: router({ post: route({ body: { id: 'string' }, handler }) }) }) },
          { name: 'x', version: '1', public: true },
        ),
      /Duplicate argument id in tool post_a_by_id/,
    );
  });

  it('requires endpoint middleware unless public', () => {
    const tree = { a: router({ get: async () => ({}) }) };
    assert.throws(() => mcp(tree, { name: 'x', version: '1' }), /public: true/);
    assert.ok(mcp(tree, { name: 'x', version: '1', public: true }));
    assert.ok(mcp(tree, { name: 'x', version: '1' }, auth));
  });

  it('answers unauthenticated tool calls with HTTP 401 behind jwtAuth', async () => {
    const secret = 'jwt-secret';
    const guarded = router({
      mcp: mcp({ users }, { name: 'x', version: '1' }, jwtAuth({ secret, claims: () => ({}) })),
    }).handler();
    const call = (headers: Record<string, string>) =>
      guarded(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...headers,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'get_users', arguments: {} },
          }),
        }),
      );
    const denied = await call({});
    assert.strictEqual(denied.status, 401);
    assert.match(denied.headers.get('WWW-Authenticate') ?? '', /^Bearer/);
    const token = await jwtSign({ sub: 'u1' }, secret);
    assert.strictEqual((await call({ Authorization: `Bearer ${token}` })).status, 200);
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
      assert.strictEqual(tools.length, 5);
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

  describe('hardening', () => {
    const uid = (c: unknown) => (c as { uid?: string }).uid ?? null;
    const profile = router({ get: async (c) => ({ uid: uid(c) }) });
    const inner = router({
      boom: router({
        get: async () => {
          throw new Error('db password=hunter2');
        },
      }),
      events: router({
        get: () =>
          new Response(new ReadableStream({ start() {} }), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      }),
      headers: router({ get: async (c) => Object.fromEntries(c.request.headers) }),
      search: router({
        get: route({ query: { q: 'string?' }, handler: async (c) => ({ q: c.query.q }) }),
      }),
      sessions: router({ delete: async () => ({ deleted: 'all' }) }),
      $id: router({ sessions: router({ delete: async (c) => ({ deleted: c.path.id }) }) }),
    });
    const opts = { name: 'test', version: '1.0.0' };
    const hardened = router({
      endpoint: router({ mcp: mcp({ profile }, opts, auth) }),
      parent: router({ mcp: mcp({ profile }, { ...opts, public: true }) }, auth),
      mcp: mcp({ inner }, { ...opts, public: true }),
    });
    const fetchHardened = hardened.handler();

    async function call(path: string, name: string, args: object, headers: object = {}) {
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`http://localhost${path}`), {
        fetch: async (url, init) => fetchHardened(new Request(url, init)),
        requestInit: { headers: { Authorization: 'Bearer good', ...headers } },
      });
      await client.connect(transport);
      return client.callTool({ name, arguments: args as Record<string, unknown> });
    }

    it('passes endpoint and parent middleware context to handlers', async () => {
      for (const path of ['/endpoint/mcp', '/parent/mcp']) {
        const result = await call(path, 'get_profile', {});
        assert.deepStrictEqual(JSON.parse(text(result)), { uid: 'u1' });
      }
    });

    it('rejects dot segments in path parameters', async () => {
      for (const id of ['.', '..']) {
        const result = await call('/mcp', 'delete_inner_by_id_sessions', { id });
        assert.strictEqual(result.isError, true);
        assert.match(text(result), /Invalid path parameter: id/);
      }
    });

    it('hides handler exceptions behind a tool error', async () => {
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        const result = await call('/mcp', 'get_inner_boom', {});
        assert.strictEqual(result.isError, true);
        assert.strictEqual(text(result), 'Internal error');
        assert.strictEqual(errors.length, 1);
      } finally {
        console.error = original;
      }
    });

    it('rejects streaming responses instead of hanging', async () => {
      const result = await call('/mcp', 'get_inner_events', {});
      assert.strictEqual(result.isError, true);
      assert.match(text(result), /Streaming responses are not supported/);
    });

    it('rejects non-scalar query arguments', async () => {
      const result = await call('/mcp', 'get_inner_search', { q: { a: 1 } });
      assert.strictEqual(result.isError, true);
      assert.match(text(result), /Invalid query parameter: q/);
    });

    it('does not forward hop-by-hop or encoding headers', async () => {
      const result = await call(
        '/mcp',
        'get_inner_headers',
        {},
        { 'X-Custom': 'yes', 'Keep-Alive': 'timeout=5', 'Content-Encoding': 'identity' },
      );
      const headers = JSON.parse(text(result));
      assert.strictEqual(headers['x-custom'], 'yes');
      assert.strictEqual(headers.authorization, 'Bearer good');
      assert.strictEqual(headers['keep-alive'], undefined);
      assert.strictEqual(headers['content-encoding'], undefined);
    });

    it('rejects cross-origin requests', async () => {
      const ping = (origin: string) =>
        fetchHardened(
          new Request('http://localhost/mcp', {
            method: 'POST',
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
          }),
        );
      assert.strictEqual((await ping('http://evil.example')).status, 403);
      assert.strictEqual((await ping('http://localhost')).status, 200);
    });

    it('builds names clients accept', async () => {
      const handler = async () => ({});
      const app = router({
        mcp: mcp({ v: router({ 'v1.0': router({ get: handler }) }) }, { ...opts, public: true }),
      });
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const fetchNamed = app.handler();
      await client.connect(
        new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
          fetch: async (url, init) => fetchNamed(new Request(url, init)),
        }),
      );
      assert.deepStrictEqual(
        (await client.listTools()).tools.map((t) => t.name),
        ['get_v_v1_0'],
      );
      assert.throws(
        () => mcp({ ['x'.repeat(130)]: router({ get: handler }) }, { ...opts, public: true }),
        /Invalid tool name/,
      );
    });
  });
});

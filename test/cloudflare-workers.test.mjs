import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { createTestHarness } from 'wrangler';

const server = createTestHarness({
  workers: [{ configPath: './test/fixtures/wrangler.jsonc' }],
});

describe('Cloudflare Workers runtime', () => {
  before(async () => {
    await server.listen();
  });

  after(async () => {
    await server.close();
  });

  it('runs a router handler in workerd with middleware', async () => {
    const response = await server.fetch('/health', {
      headers: { Origin: 'https://example.com' },
    });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match(response.headers.get('X-Request-ID') ?? '', /^[0-9a-f-]{36}$/);
    assert.deepStrictEqual(await response.json(), {
      requestId: response.headers.get('X-Request-ID'),
      runtime: 'workerd',
    });
  });

  it('validates and coerces query and body schemas', async () => {
    const queryResponse = await server.fetch('/echo?count=3&message=hello');
    assert.deepStrictEqual(await queryResponse.json(), { count: 3, message: 'hello' });

    const bodyResponse = await server.fetch('/echo', {
      body: JSON.stringify({ enabled: true, name: 'router' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.deepStrictEqual(await bodyResponse.json(), { enabled: true, name: 'router' });
  });

  it('streams server-sent events', async () => {
    const response = await server.fetch('/events');

    assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');
    assert.match(await response.text(), /event: ready\ndata: {"runtime":"workerd"}/);
  });

  it('serves MCP tool calls', async () => {
    const rpc = (id, method, params) =>
      server.fetch('/mcp', {
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

    const list = await (await rpc(1, 'tools/list', {})).json();
    assert.deepStrictEqual(
      list.result.tools.map((tool) => tool.name),
      ['get_echo', 'post_echo'],
    );

    const call = await (
      await rpc(2, 'tools/call', {
        name: 'get_echo',
        arguments: { count: 2, message: 'hi' },
      })
    ).json();
    assert.deepStrictEqual(call.result, {
      content: [{ type: 'text', text: '{"count":2,"message":"hi"}' }],
      structuredContent: { count: 2, message: 'hi' },
      isError: false,
    });
  });
});

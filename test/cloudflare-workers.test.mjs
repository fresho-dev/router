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
});

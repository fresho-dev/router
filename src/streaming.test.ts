import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sseResponse, streamJsonLines } from './streaming.js';

describe('streaming', () => {
  describe('sseResponse()', () => {
    it('returns a Response with correct headers', async () => {
      const response = sseResponse(async (send, close) => {
        close();
      });

      assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');
      assert.strictEqual(response.headers.get('Cache-Control'), 'no-cache');
      assert.strictEqual(response.headers.get('Connection'), 'keep-alive');
    });

    it('sends simple data messages', async () => {
      const response = sseResponse(async (send, close) => {
        send({ data: 'hello' });
        send({ data: 'world' });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('data: hello'));
      assert.ok(text.includes('data: world'));
    });

    it('sends JSON object as data', async () => {
      const response = sseResponse(async (send, close) => {
        send({ data: { count: 42, name: 'test' } });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('data: {"count":42,"name":"test"}'));
    });

    it('includes event type when specified', async () => {
      const response = sseResponse(async (send, close) => {
        send({ event: 'update', data: 'payload' });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('event: update'));
      assert.ok(text.includes('data: payload'));
    });

    it('includes event ID when specified', async () => {
      const response = sseResponse(async (send, close) => {
        send({ id: '123', data: 'payload' });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('id: 123'));
    });

    it('includes retry hint when specified', async () => {
      const response = sseResponse(async (send, close) => {
        send({ retry: 5000, data: 'payload' });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('retry: 5000'));
    });

    it('handles multiline data', async () => {
      const response = sseResponse(async (send, close) => {
        send({ data: 'line1\nline2\nline3' });
        close();
      });

      const text = await response.text();
      assert.ok(text.includes('data: line1'));
      assert.ok(text.includes('data: line2'));
      assert.ok(text.includes('data: line3'));
    });

    it('accepts custom headers', async () => {
      const response = sseResponse(
        async (send, close) => close(),
        { headers: { 'X-Custom-Header': 'custom-value' } }
      );

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'custom-value');
      assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');
    });
  });

  describe('streamJsonLines()', () => {
    it('returns a Response with correct content type', async () => {
      const response = streamJsonLines(async (send, close) => {
        close();
      });

      assert.strictEqual(response.headers.get('Content-Type'), 'application/x-ndjson');
    });

    it('sends objects as newline-delimited JSON', async () => {
      const response = streamJsonLines(async (send, close) => {
        send({ id: 1, name: 'first' });
        send({ id: 2, name: 'second' });
        send({ id: 3, name: 'third' });
        close();
      });

      const text = await response.text();
      const lines = text.trim().split('\n');
      assert.strictEqual(lines.length, 3);
      assert.deepStrictEqual(JSON.parse(lines[0]), { id: 1, name: 'first' });
      assert.deepStrictEqual(JSON.parse(lines[1]), { id: 2, name: 'second' });
      assert.deepStrictEqual(JSON.parse(lines[2]), { id: 3, name: 'third' });
    });

    it('accepts custom headers', async () => {
      const response = streamJsonLines(
        async (send, close) => close(),
        { headers: { 'X-Custom-Header': 'custom-value' } }
      );

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'custom-value');
      assert.strictEqual(response.headers.get('Content-Type'), 'application/x-ndjson');
    });
  });
});

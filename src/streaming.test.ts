import assert from 'node:assert';
import { describe, it } from 'node:test';
import { router } from './core.js';
import { createHttpClient } from './http-client.js';
import { type SSEEventsOf, sseResponse, streamJsonLines } from './streaming.js';

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
      const response = sseResponse(async (send, close) => close(), {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'custom-value');
      assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');
    });

    it('type-checks event names and their corresponding payloads', async () => {
      interface Events {
        message: { connected: boolean };
        update: { count: number };
        removed: { id: string };
      }

      const response = sseResponse<Events>((send, close) => {
        send({ data: { connected: true } });
        send({ event: 'update', data: { count: 1 } });
        send({ event: 'removed', data: { id: 'item-1' } });

        const rejectInvalidMessages = () => {
          // @ts-expect-error Unknown event name.
          send({ event: 'udpate', data: { count: 2 } });
          // @ts-expect-error Payload does not match the event.
          send({ event: 'update', data: { id: 'item-2' } });
          // @ts-expect-error Named events require an event field.
          send({ data: { count: 3 } });
        };
        void rejectInvalidMessages;

        close();
      });

      const text = await response.text();
      assert.ok(text.includes('data: {"connected":true}'));
      assert.ok(text.includes('event: update\ndata: {"count":1}'));
      assert.ok(text.includes('event: removed\ndata: {"id":"item-1"}'));
    });

    it('carries the event map through the typed HTTP client', () => {
      interface Events {
        update: { count: number };
      }

      const api = router({
        events: router({
          get: async () =>
            sseResponse<Events>((send, close) => {
              send({ event: 'update', data: { count: 1 } });
              close();
            }),
        }),
      });
      const client = createHttpClient<typeof api>({});

      type ClientEvents = SSEEventsOf<ReturnType<typeof client.events>>;
      type IsExact = Events extends ClientEvents
        ? ClientEvents extends Events
          ? true
          : false
        : false;
      const _isExact: IsExact = true;

      assert.ok(true);
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
      const response = streamJsonLines(async (send, close) => close(), {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      assert.strictEqual(response.headers.get('X-Custom-Header'), 'custom-value');
      assert.strictEqual(response.headers.get('Content-Type'), 'application/x-ndjson');
    });
  });
});

/**
 * @fileoverview Streaming response utilities for typed-routes.
 *
 * Provides helpers for Server-Sent Events (SSE) and newline-delimited JSON (NDJSON)
 * streaming responses. These are useful for real-time updates, progress indicators,
 * and streaming large datasets.
 *
 * Available utilities:
 * - {@link sseResponse} - Server-Sent Events for real-time browser updates
 * - {@link streamJsonLines} - NDJSON for streaming JSON objects line by line
 *
 * @example
 * ```typescript
 * import { router, sseResponse, streamJsonLines } from 'typed-routes';
 *
 * const api = router({
 *   // SSE for real-time updates
 *   events: router({
 *     get: async () => sseResponse(async (send, close) => {
 *       for (let i = 0; i < 10; i++) {
 *         send({ event: 'tick', data: { count: i } });
 *         await sleep(1000);
 *       }
 *       close();
 *     }),
 *   }),
 *
 *   // NDJSON for streaming data
 *   export: router({
 *     get: async () => streamJsonLines(async (send, close) => {
 *       for await (const row of database.stream()) {
 *         send(row);
 *       }
 *       close();
 *     }),
 *   }),
 * });
 * ```
 */

/**
 * Options for SSE response.
 */
export interface SSEOptions {
  /** Custom headers to include in the response. */
  headers?: HeadersInit;
  /** Interval in milliseconds to send keep-alive comments (default: 30000). */
  keepAliveInterval?: number;
}

/**
 * Server-Sent Event message structure.
 */
export interface SSEMessage {
  /** Event type (optional). */
  event?: string;
  /** Event data. */
  data: string | object;
  /** Event ID (optional). */
  id?: string;
  /** Retry interval hint for client (optional). */
  retry?: number;
}

/**
 * Formats an SSE message for transmission.
 */
function formatSSEMessage(message: SSEMessage): string {
  const lines: string[] = [];

  if (message.event) {
    lines.push(`event: ${message.event}`);
  }

  if (message.id) {
    lines.push(`id: ${message.id}`);
  }

  if (message.retry !== undefined) {
    lines.push(`retry: ${message.retry}`);
  }

  // Data can be a string or object (will be JSON stringified).
  const data = typeof message.data === 'string' ? message.data : JSON.stringify(message.data);

  // Split data by newlines and prefix each line with 'data: '.
  for (const line of data.split('\n')) {
    lines.push(`data: ${line}`);
  }

  return lines.join('\n') + '\n\n';
}

/**
 * Creates a Server-Sent Events (SSE) response.
 *
 * @example
 * ```typescript
 * const handler = async (c) => {
 *   return sseResponse(async (send, close) => {
 *     for (let i = 0; i < 5; i++) {
 *       await send({ data: { count: i } });
 *       await new Promise(r => setTimeout(r, 1000));
 *     }
 *     close();
 *   });
 * };
 * ```
 */
export function sseResponse(
  handler: (
    send: (message: SSEMessage) => void,
    close: () => void
  ) => void | Promise<void>,
  options: SSEOptions = {}
): Response {
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send function for the handler.
      const send = (message: SSEMessage) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(formatSSEMessage(message)));
        }
      };

      // Close function for the handler.
      const close = () => {
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      };

      // Optional keep-alive interval.
      const keepAliveInterval = options.keepAliveInterval ?? 30_000;
      let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

      if (keepAliveInterval > 0) {
        keepAliveTimer = setInterval(() => {
          if (!isClosed) {
            // Send a comment as keep-alive.
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          }
        }, keepAliveInterval);
      }

      try {
        await handler(send, close);
      } finally {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
        }
        if (!isClosed) {
          controller.close();
        }
      }
    },
  });

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');

  return new Response(stream, { headers });
}

/**
 * Creates a streaming JSON response where each line is a JSON object.
 *
 * Useful for streaming large datasets or real-time data where each item
 * can be processed as it arrives (NDJSON format).
 *
 * @example
 * ```typescript
 * const handler = async (c) => {
 *   return streamJsonLines(async (send, close) => {
 *     for (const item of largeDataset) {
 *       await send(item);
 *     }
 *     close();
 *   });
 * };
 * ```
 */
export function streamJsonLines(
  handler: (
    send: (data: object) => void,
    close: () => void
  ) => void | Promise<void>,
  options: { headers?: HeadersInit } = {}
): Response {
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        }
      };

      const close = () => {
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      };

      try {
        await handler(send, close);
      } finally {
        if (!isClosed) {
          controller.close();
        }
      }
    },
  });

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/x-ndjson');

  return new Response(stream, { headers });
}

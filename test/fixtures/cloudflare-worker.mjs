import { route, router, sseResponse } from '../../dist/index.mjs';
import { cors, requestId } from '../../dist/middleware/index.mjs';

const api = router(
  {
    health: router({
      get: async (context) => ({
        requestId: context.requestId,
        runtime: typeof WebSocketPair === 'function' ? 'workerd' : 'unknown',
      }),
    }),
    echo: router({
      get: route({
        query: { count: 'number', message: 'string' },
        handler: async (context) => ({
          count: context.query.count,
          message: context.query.message,
        }),
      }),
      post: route({
        body: { enabled: 'boolean', name: 'string' },
        handler: async (context) => context.body,
      }),
    }),
    events: router({
      get: async () =>
        sseResponse((send, close) => {
          send({ event: 'ready', data: { runtime: 'workerd' } });
          close();
        }),
    }),
  },
  cors(),
  requestId(),
);

export default {
  fetch: api.handler(),
};

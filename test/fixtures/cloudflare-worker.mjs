import { route, router, sseResponse } from '../../dist/index.mjs';
import { mcp } from '../../dist/mcp/index.mjs';
import { cors, requestId } from '../../dist/middleware/index.mjs';

const echo = router({
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
});

const api = router(
  {
    health: router({
      get: async (context) => ({
        requestId: context.requestId,
        runtime: typeof WebSocketPair === 'function' ? 'workerd' : 'unknown',
      }),
    }),
    echo,
    events: router({
      get: async () =>
        sseResponse((send, close) => {
          send({ event: 'ready', data: { runtime: 'workerd' } });
          close();
        }),
    }),
    mcp: mcp({ echo }, { name: 'workerd', version: '1.0.0', public: true }),
  },
  cors(),
  requestId(),
);

export default {
  fetch: api.handler(),
};

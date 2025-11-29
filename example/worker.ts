/**
 * Cloudflare Workers entrypoint.
 *
 * Deploy with: wrangler deploy
 */

import { api } from './server.js';

export default {
  fetch: api.handler(),
};

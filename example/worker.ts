/**
 * Cloudflare Workers entrypoint.
 *
 * Deploy with: wrangler deploy
 */

import { createHandler } from 'typed-routes';
import { api } from './server.js';

export default {
  fetch: createHandler(api),
};

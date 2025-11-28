/**
 * Deno entrypoint.
 *
 * Run with: deno run --allow-net deno.ts
 */

import { createHandler } from 'typed-routes';
import { api } from './server.js';

const handler = createHandler(api);

Deno.serve({ port: 3000 }, handler);
console.log('Server running at http://localhost:3000');

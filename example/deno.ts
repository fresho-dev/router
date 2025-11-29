/**
 * Deno entrypoint.
 *
 * Run with: deno run --allow-net deno.ts
 */

import { api } from './server.js';

Deno.serve({ port: 3000 }, api.handler());
console.log('Server running at http://localhost:3000');

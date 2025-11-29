/**
 * Node.js entrypoint.
 *
 * Run with: npx tsx node.ts
 */

import { createServer } from 'node:http';
import { api } from './server.js';

const handler = api.handler();

// Adapt Node's http server to use the fetch handler.
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // Build headers from Node's IncomingMessage.
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  // Read body for non-GET requests.
  const body = await new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

  // Create a standard Request object.
  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    body: ['POST', 'PUT', 'PATCH'].includes(req.method ?? '') ? body : undefined,
  });

  // Call handler and write response.
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await response.text());
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

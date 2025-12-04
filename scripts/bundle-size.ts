#!/usr/bin/env -S npx tsx

import { gzipSync } from 'node:zlib';
import esbuild, { type Metafile } from 'esbuild';

interface MeasureResult {
  name: string;
  size: number;
  gzip: number;
  metafile: Metafile;
}

async function measure(name: string, code: string): Promise<MeasureResult> {
  const result = await esbuild.build({
    stdin: {
      contents: code,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    metafile: true,
  });
  const size = result.outputFiles[0].text.length;
  const gzip = gzipSync(result.outputFiles[0].text).length;
  return { name, size, gzip, metafile: result.metafile };
}

function printResult(r: MeasureResult): void {
  console.log(
    `${r.name.padEnd(30)} ${(r.size / 1024).toFixed(1).padStart(6)} KB  (${(r.gzip / 1024).toFixed(1)} KB gzip)`,
  );
}

function analyzeMetafile(metafile: Metafile): void {
  const inputs = metafile.inputs;
  const sizes: Array<{ file: string; bytes: number }> = [];
  for (const [file, info] of Object.entries(inputs)) {
    if (file.startsWith('src/')) {
      sizes.push({ file, bytes: info.bytes });
    }
  }
  sizes.sort((a, b) => b.bytes - a.bytes);
  console.log('\n  Source breakdown:');
  for (const { file, bytes } of sizes.slice(0, 10)) {
    console.log(`    ${file.padEnd(35)} ${bytes.toString().padStart(5)} bytes`);
  }
}

// Test cases.
const coreOnly = await measure(
  'Core only',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export default { fetch: api.handler() };
`,
);

const withValidation = await measure(
  'With validation',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({
      method: 'get',
      path: '/hello',
      query: { name: 'string', count: 'number?' },
      handler: (c) => ({ msg: c.params.query.name })
    }),
  });
  export default { fetch: api.handler() };
`,
);

const withHttpClient = await measure(
  'With httpClient',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export const client = api.httpClient();
`,
);

const withLocalClient = await measure(
  'With localClient',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export const client = api.localClient();
`,
);

const withBothClients = await measure(
  'With both clients',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export const http = api.httpClient();
  export const local = api.localClient();
`,
);

const handlerOnly = await measure(
  'Handler only (no clients)',
  `
  import { route, router } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export default { fetch: api.handler() };
  // Don't use httpClient or localClient
`,
);

const withMiddleware = await measure(
  '+ cors, errorHandler',
  `
  import { route, router } from './src/index.ts';
  import { cors, errorHandler } from './src/middleware/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  }, [cors(), errorHandler()]);
  export default { fetch: api.handler() };
`,
);

const withDocs = await measure(
  'With generateDocs',
  `
  import { route, router, generateDocs } from './src/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  });
  export default { fetch: api.handler() };
  export const docs = generateDocs({ title: 'API', version: '1.0', router: api });
`,
);

const withAllMiddleware = await measure(
  '+ all middleware',
  `
  import { route, router } from './src/index.ts';
  import { cors, errorHandler, logger, rateLimit, basicAuth, jwtAuth, bearerAuth, requestId, timeout, contentType } from './src/middleware/index.ts';
  const api = router('/api', {
    hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
  }, [cors(), errorHandler(), logger(), rateLimit(), basicAuth({ validate: () => true }), bearerAuth({ validate: () => true }), requestId(), timeout(), contentType()]);
  export default { fetch: api.handler() };
`,
);

console.log('Bundle sizes:');
console.log('─'.repeat(55));
printResult(coreOnly);
printResult(withValidation);
printResult(handlerOnly);
printResult(withHttpClient);
printResult(withLocalClient);
printResult(withBothClients);
console.log('─'.repeat(55));
printResult(withDocs);
printResult(withMiddleware);
printResult(withAllMiddleware);

console.log('\n\nCore bundle analysis:');
analyzeMetafile(coreOnly.metafile);

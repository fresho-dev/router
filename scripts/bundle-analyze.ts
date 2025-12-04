#!/usr/bin/env -S npx tsx

import esbuild from 'esbuild';

// Build with readable output to see what's included.
const result = await esbuild.build({
  stdin: {
    contents: `
      import { route, router } from './src/index.ts';
      const api = router('/api', {
        hello: route({ method: 'get', path: '/hello', handler: () => ({ msg: 'hi' }) }),
      });
      export default { fetch: api.handler() };
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  minify: false,
  format: 'esm',
  write: false,
  platform: 'browser',
});

const code = result.outputFiles[0].text;
console.log('Unminified bundle size:', (code.length / 1024).toFixed(1), 'KB');
console.log('');
console.log('=== BUNDLE CONTENTS ===');
console.log(code);

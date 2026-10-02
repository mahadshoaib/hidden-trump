import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle the shared TypeScript into the server; runtime needs only Node and
// production npm dependencies, not tsx or the TypeScript compiler.
await build({
  entryPoints: [fileURLToPath(new URL('./src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/index.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  alias: {
    '@hidden-trump/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
  },
  logLevel: 'info',
});

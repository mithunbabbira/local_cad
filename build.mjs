import { build } from 'esbuild';
await build({ entryPoints: ['src/app.js'], bundle: true, outfile: 'src/bundle.js', format: 'iife', loader: { '.json': 'json' }, minify: true });
await build({ entryPoints: ['src/core.js'], bundle: true, outfile: 'build/core.mjs', format: 'esm', platform: 'node', loader: { '.json': 'json' } });

import { build } from 'esbuild';
await build({ entryPoints: ['src/server.ts'], outfile: 'desktop/backend.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', packages: 'external' });
console.log('Desktop backend ready.');

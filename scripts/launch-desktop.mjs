import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build'], ['scripts/build-desktop.mjs']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; }); child.unref();

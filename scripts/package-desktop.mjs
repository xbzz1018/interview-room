import { packager } from '@electron/packager';
import { readFileSync, mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Stage only built assets and runtime dependencies. Never copy data, backups or local tools.
const stage = resolve('local_tools', `desktop-stage-${Date.now()}`);
mkdirSync(join(stage, 'desktop'), { recursive: true });
for (const file of ['desktop/main.mjs', 'desktop/backend.mjs', 'LICENSE', 'DEPENDENCIES.md']) cpSync(file, join(stage, file));
cpSync('dist', join(stage, 'dist'), { recursive: true });
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'interview-room', productName: '面试练习室', version: manifest.version, type: 'module', main: 'desktop/main.mjs', author: manifest.author, license: manifest.license }));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev || !existsSync(directory)) continue;
  cpSync(directory, join(stage, directory), { recursive: true });
}
const paths = await packager({ dir: stage, out: 'release', name: 'Interview Room', executableName: 'Interview Room', platform: 'win32', arch: 'x64', asar: false, overwrite: true, electronVersion: manifest.devDependencies.electron, win32metadata: { ProductName: '面试练习室', FileDescription: '面试练习室 · Interview Room', CompanyName: 'xbzz1018' } });
for (const path of paths) {
  const appRoot = join(path, 'resources', 'app');
  for (const name of ['data', 'local_tools', '.env', 'tests', 'scripts']) if (existsSync(join(appRoot, name))) throw new Error(`Unexpected private/development directory in package: ${name}`);
}
console.log('Windows desktop package:', ...paths);

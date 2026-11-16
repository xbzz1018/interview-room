import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const sections = ['# Production dependencies\n\nGenerated from the installed production packages and package-lock.json. The application LICENSE does not replace these terms. Development tools and Node.js retain their own licenses. Native binaries may bundle additional components; preserve their distributed metadata and notices when redistributing them.\n\nThe Windows desktop distribution also includes Electron. Preserve its runtime LICENSE and LICENSES.chromium.html beside the executable; those cover Electron, Chromium and their bundled components. Electron is a development dependency in the source workspace but a runtime in the desktop distribution.\n'];
for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev || !existsSync(directory)) continue;
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  sections.push(`## ${pkg.name} ${pkg.version}\n\nDeclared license: ${pkg.license ?? entry.license ?? 'See package'}.\n`);
  let files = readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  let licenseDirectory = directory;
  if (!files.length && pkg.name.startsWith('@napi-rs/canvas-')) {
    licenseDirectory = 'node_modules/@napi-rs/canvas';
    const parent = JSON.parse(readFileSync(join(licenseDirectory, 'package.json'), 'utf8'));
    if (parent.version !== pkg.version || parent.repository?.url !== pkg.repository?.url) throw new Error('Native package license relationship needs review');
    files = ['LICENSE'];
    sections.push('Platform distribution of @napi-rs/canvas from the same repository and version. Its application-level MIT text follows; keep the native package SBOM for bundled components.\n');
  }
  if (!files.length) throw new Error(`No license text found for ${pkg.name}`);
  for (const file of files) sections.push(`### ${file}\n\n~~~~text\n${readFileSync(join(licenseDirectory, file), 'utf8').trim()}\n~~~~\n`);
}
writeFileSync('DEPENDENCIES.md', sections.join('\n'));
console.log('Updated DEPENDENCIES.md from installed production packages.');

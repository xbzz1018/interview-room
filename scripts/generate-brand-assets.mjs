import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontendRequire = createRequire(join(root, 'frontend/package.json'));
const platformRequire = createRequire(join(root, 'packages/platform/package.json'));
const pdfRequire = createRequire(platformRequire.resolve('pdfjs-dist/package.json'));
const { createElement } = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const { BookOpenCheck } = frontendRequire('lucide-react');
// Reuse PDF.js's locked optional canvas dependency; no extra image build runtime.
const { createCanvas, loadImage } = pdfRequire('@napi-rs/canvas');

const glyph = renderToStaticMarkup(createElement(BookOpenCheck, {
  x: 196, y: 196, width: 632, height: 632, color: '#ffffff', strokeWidth: 1.8,
  'aria-hidden': true,
}));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="面试练习室"><!-- BookOpenCheck: Lucide ISC; see docs/third-party/lucide.txt --><rect width="1024" height="1024" rx="224" fill="#294e85"/>${glyph}</svg>\n`;
for (const name of ['frontend/public/logo-mark.svg', 'apps/desktop/build/icon.svg', 'images/interview-room-mark.svg']) {
  await writeFile(join(root, name), svg);
}
const artwork = await loadImage(Buffer.from(svg));
async function png(size) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  context.drawImage(artwork, 0, 0, size, size);
  return canvas.encode('png');
}
await writeFile(join(root, 'apps/desktop/build/icon.png'), await png(1024));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (let index = 0; index < frames.length; index++) {
  const start = 6 + index * 16;
  header[start] = sizes[index] === 256 ? 0 : sizes[index];
  header[start + 1] = header[start];
  header.writeUInt16LE(1, start + 4);
  header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(frames[index].length, start + 8);
  header.writeUInt32LE(offset, start + 12);
  offset += frames[index].length;
}
await writeFile(join(root, 'apps/desktop/build/icon.ico'), Buffer.concat([header, ...frames]));
const lucideLicense = join(dirname(frontendRequire.resolve('lucide-react/package.json')), 'LICENSE');
await mkdir(join(root, 'docs/third-party'), { recursive: true });
await writeFile(join(root, 'docs/third-party/lucide.txt'), await readFile(lucideLicense));
console.log('Generated Interview Room SVG, 1024px PNG and seven-size ICO with Lucide notices.');

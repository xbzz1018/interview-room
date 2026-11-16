import { _electron as electron, chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startWorkspace, workspaceId } from '../src/server.ts';
const directory = mkdtempSync(join(tmpdir(), 'interview-room-desktop-'));
const dataRoot = join(directory, 'data'), userRoot = join(directory, 'user');
mkdirSync('local_tools/ui', { recursive: true });
const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port; await new Promise<void>(done => listener.close(() => done()));
const url = `http://127.0.0.1:${port}`;
const executablePath = process.env.INTERVIEW_DESKTOP_EXE;
const args = [`--port=${port}`, `--data-dir=${dataRoot}`, `--user-data-dir=${userRoot}`];
const checks: string[] = [], errors: string[] = [];
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
delete env.ELECTRON_RUN_AS_NODE;
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined, external: Awaited<ReturnType<typeof startWorkspace>> | undefined;
async function launch() {
  desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? args : ['.', ...args], cwd: process.cwd(), env });
  const page = await desktop.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /开始面试/ }).click();
  await page.getByRole('heading', { name: '开始一轮面试', exact: true }).waitFor();
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), true);
  return page;
}
async function api(path: string, method = 'GET', value?: unknown) {
  const boot = await (await fetch(url + '/api/bootstrap')).json() as { token: string; workspaceId: string };
  assert.equal(boot.workspaceId, workspaceId(dataRoot));
  const response = await fetch(url + '/api' + path, { method, headers: { Authorization: `Bearer ${boot.token}`, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
  assert.equal(response.ok, true, `API ${path}: ${response.status}`); return response.json();
}
try {
  let page = await launch();
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  checks.push('real isolated desktop window owns local service');
  await api('/materials', 'POST', { title: '合成桌面简历', kind: 'resume', text: '仅用于测试窗口与资料持久化。' });
  await page.reload();
  await page.getByLabel('练习名称', { exact: true }).fill('桌面准备草稿');
  await page.getByRole('button', { name: '深灰青绿', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'forest');
  await page.getByRole('button', { name: /备面知识库/ }).click();
  await page.locator('.domain-entry').filter({ hasText: /^Python/ }).click();
  await page.getByRole('heading', { name: 'Python · 快速提纲', exact: true }).waitFor();
  assert.equal(await page.getByLabel('阅读文件', { exact: true }).count(), 0);
  const knowledgeFiles = await api('/materials');
  assert.equal(knowledgeFiles.some((item: { id: string }) => item.id.endsWith('-guide-v1')), false);
  await page.getByRole('heading', { name: /对象与参数$/ }).waitFor();
  await page.screenshot({ path: 'local_tools/ui/desktop-knowledge.png' });
  // Exercise the external PDF runtime from the actual packaged backend, without private files.
  const pdf = '%PDF-1.1\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>> endobj\n4 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj\n5 0 obj <</Length 52>> stream\nBT /F1 12 Tf 50 700 Td (Desktop synthetic PDF) Tj ET\nendstream endobj\ntrailer <</Root 1 0 R>>\n%%EOF';
  const extracted = await api('/extract', 'POST', { type: 'pdf', base64: Buffer.from(pdf).toString('base64') });
  assert.match(extracted.text, /Desktop synthetic PDF/);
  checks.push('packaged PDF extraction and knowledge reading');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const web = await browser.newPage(); await web.goto(url);
    await web.getByRole('button', { name: /我的简历/ }).click();
    await web.getByRole('heading', { name: '合成桌面简历', exact: true }).waitFor();
    checks.push('browser and desktop share saved records');
  } finally { await browser.close(); }
  await desktop!.close(); desktop = undefined;
  assert.equal(existsSync(join(dataRoot, 'instance.lock')), false);
  assert.equal(await fetch(url + '/api/bootstrap').then(() => true, () => false), false);
  checks.push('desktop-owned service and lock close cleanly');
  page = await launch();
  assert.equal(await page.getByLabel('练习名称', { exact: true }).inputValue(), '桌面准备草稿');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'forest');
  assert.equal((await api('/materials')).some((item: { title: string }) => item.title === '合成桌面简历'), true);
  checks.push('relaunch restores saved records, desktop draft and theme');
  await desktop!.close(); desktop = undefined;
  external = await startWorkspace({ port, dataRoot, staticRoot: resolve('dist') });
  await launch(); await desktop!.close(); desktop = undefined;
  assert.equal((await api('/topics')).length, 12);
  checks.push('closing desktop preserves an externally started web service');
  assert.deepEqual(errors, []);
  writeFileSync('local_tools/ui/desktop-results.json', JSON.stringify({ checks, errors, packaged: Boolean(executablePath) }, null, 2));
  console.log(`Desktop passed: ${checks.length} workflows (${executablePath ? 'packaged exe' : 'development runtime'})`);
} finally {
  await desktop?.close(); await external?.close(); rmSync(directory, { recursive: true, force: true });
}

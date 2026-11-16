import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('importing the backend ignores non-file Electron command-line arguments', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "process.argv[1] = '--port=45678'; await import('./src/server.ts'); console.log('imported');"], { cwd: resolve('.'), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /imported/);
});

test('production entry starts with blank credentials and preserves personal records across process restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'interview-startup-'));
  const allocation = createServer(); await new Promise<void>(resolve => allocation.listen(0, '127.0.0.1', resolve));
  const address = allocation.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>(resolve => allocation.close(() => resolve()));
  let child: ReturnType<typeof spawn> | undefined;
  const start = async () => {
    child = spawn(process.execPath, [resolve('src/server.ts')], { env: { ...process.env, INTERVIEW_PORT: String(port), INTERVIEW_DATA_DIR: directory }, stdio: 'pipe', windowsHide: true });
    let diagnostic = ''; child.stderr?.on('data', data => { diagnostic += data; });
    for (let count = 0; count < 80; count++) {
      if (child.exitCode !== null) throw new Error(`Production process exited: ${diagnostic}`);
      try { const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`); const result = await response.json(); if (result.app === 'interview-room-v2') return result.token as string; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Production process did not become ready');
  };
  const stop = async () => { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } child = undefined; };
  const request = async (token: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok); return response.json();
  };
  try {
    const first = await start(); assert.equal((await request(first, '/settings')).hasApiKey, false);
    const material = await request(first, '/materials', { title: '合成重启测试', kind: 'resume', text: '仅合成材料' });
    await stop(); const second = await start(); assert.notEqual(first, second);
    assert.equal((await request(second, '/materials'))[0].id, material.id);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});

test('Windows double-click entry uses CRLF, starts the UI and reopens an existing instance', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const script = readFileSync('启动网页版.cmd', 'utf8');
  assert.ok(script.includes('\r\n')); assert.ok(!/(?<!\r)\n/.test(script), 'Batch files must retain CRLF on checkout');
  const directory = mkdtempSync(join(tmpdir(), 'interview-launcher-'));
  const allocation = createServer(); await new Promise<void>(resolve => allocation.listen(0, '127.0.0.1', resolve));
  const address = allocation.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>(resolve => allocation.close(() => resolve()));
  const environment = { ...process.env, INTERVIEW_PORT: String(port), INTERVIEW_DATA_DIR: directory, INTERVIEW_NO_BROWSER: '1', INTERVIEW_NO_PAUSE: '1' };
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', '启动网页版.cmd'], { cwd: resolve('.'), env: environment, stdio: 'pipe', windowsHide: true });
  let diagnostic = ''; child.stdout?.on('data', data => { diagnostic += data; }); child.stderr?.on('data', data => { diagnostic += data; });
  const exited = once(child, 'exit');
  try {
    let ready = false;
    for (let count = 0; count < 160; count++) {
      if (child.exitCode !== null) throw new Error(`Windows launcher exited: ${diagnostic}`);
      try { const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`); ready = (await response.json()).app === 'interview-room-v2'; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, diagnostic);
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    const asset = html.match(/src="([^"]+\.js)"/); assert.ok(asset, 'Launcher serves a built UI');
    const response = await fetch(`http://127.0.0.1:${port}${asset[1]}`); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
    const reopen = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', '启动网页版.cmd'], { cwd: resolve('.'), env: environment, stdio: 'pipe', windowsHide: true });
    let reopened = ''; reopen.stdout?.on('data', data => { reopened += data; });
    const [code] = await once(reopen, 'exit'); assert.equal(code, 0); assert.match(reopened, /4318|打开地址/);
    assert.doesNotMatch(diagnostic, /not recognized|Startup failed|Node.js 24.15 or newer is required/);
  } finally {
    if (child.exitCode === null && child.pid) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await exited;
    // Let Windows release descendant SQLite mappings without blocking child-process events.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

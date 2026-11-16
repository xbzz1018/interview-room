import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startWorkspace, workspaceId } from '../src/server.ts';

test('shared workspace publishes identity, serves configured assets and releases its lock on close', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'interview-workspace-'));
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port; await new Promise<void>(done => server.close(() => done()));
  try {
    writeFileSync(join(directory, 'index.html'), '<h1>workspace asset</h1>');
    const app = await startWorkspace({ port, dataRoot: directory, staticRoot: directory });
    try {
      const boot = await (await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).json();
      assert.equal(boot.workspaceId, workspaceId(directory));
      assert.match(await (await fetch(`http://127.0.0.1:${port}`)).text(), /workspace asset/);
      await assert.rejects(startWorkspace({ port: port + 1, dataRoot: directory }), /数据目录已/);
    } finally { await Promise.all([app.close(), app.close()]); }
    assert.equal(existsSync(join(directory, 'instance.lock')), false);
    const restarted = await startWorkspace({ port, dataRoot: directory }); await restarted.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('failed listen releases only its own workspace lock', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'interview-listen-'));
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(startWorkspace({ port, dataRoot: directory }), /EADDRINUSE/);
    assert.equal(existsSync(join(directory, 'instance.lock')), false);
  } finally { await new Promise<void>(done => server.close(() => done())); rmSync(directory, { recursive: true, force: true }); }
});

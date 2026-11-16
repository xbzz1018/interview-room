import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertPreparation } from '../src/prep.ts';
import { previewImport } from '../src/migration.ts';
import { Store } from '../src/store.ts';
import { acquireInstance } from '../src/instance.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('explicit preparation pack preserves source lines and groups study cards without filesystem access', () => {
  const result = convertPreparation({ projects: [{ name: '合成项目', sources: [{ path: 'src/store.ts', kind: 'current_source', start_line: 41, content: 'first\nsecond', sha256: 'declared-hash' }] }],
    topics: [{ name: '数据库', cards: [{ filename: 'A01.md', content: '事务隔离' }, { filename: 'A02.md', content: '索引取舍' }] }] });
  assert.equal(result.materials.length, 2); assert.match(result.materials[0].text, /不能作为本人已完成工作的证明/);
  assert.match(result.materials[1].text, /41: first\n42: second/); assert.match(result.materials[1].text, /未读取文件核验/);
  const store = new Store(':memory:'); assert.equal(previewImport(result, store).materials.length, 2); store.close();
  assert.equal(convertPreparation({ projects: [], topics: [{ name: '数据库', cards: [{ filename: 'A01.md', content: '事务隔离' }, { filename: 'A02.md', content: '索引取舍' }] }] }).materials[0].id, result.materials[0].id);
});
test('data directory lock rejects a second instance and recovers a stale process lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'interview-lock-'));
  try {
    const release = acquireInstance(directory); assert.throws(() => acquireInstance(directory), /已被面试练习室使用/); release();
    writeFileSync(join(directory, 'instance.lock'), '2147483646'); const unlocked = acquireInstance(directory); unlocked();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

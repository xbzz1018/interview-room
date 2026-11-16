import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { previewImport } from '../src/migration.ts';
import { Store } from '../src/store.ts';

test('legacy exporter reads only selected text modes and opt-in knowledge without mutating the source DB', () => {
  const root = mkdtempSync(join(tmpdir(), 'interview-export-'));
  try {
    const path = join(root, 'legacy.db'), output = join(root, 'backup.json'), db = new DatabaseSync(path);
    db.exec('CREATE TABLE sessions (session_id TEXT, user_id TEXT, mode TEXT, questions TEXT, transcript TEXT, meta TEXT); CREATE TABLE resume_interview_state (session_id TEXT, user_id TEXT, state TEXT); CREATE TABLE private_keys (secret TEXT);');
    db.prepare('INSERT INTO private_keys VALUES (?)').run('SHOULD_NEVER_EXPORT');
    for (const mode of ['resume', 'topic_drill', 'jd_prep', 'recording']) db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
      .run(mode, 'synthetic', mode, '[]', JSON.stringify([{ role: 'assistant', content: '介绍职责' }, { role: 'user', content: '合成答案' }]), '{}');
    db.prepare('INSERT INTO resume_interview_state VALUES (?,?,?)').run('resume', 'synthetic', JSON.stringify({ resume_context: '历史冻结材料', target_role: '后端实习生' }));
    db.close();
    mkdirSync(join(root, 'users', 'synthetic', 'knowledge', 'database'), { recursive: true });
    writeFileSync(join(root, 'users', 'synthetic', 'knowledge', 'database', 'A01.md'), '事务隔离题卡');
    writeFileSync(join(root, 'users', 'synthetic', 'topics.json'), JSON.stringify({ database: { name: '数据库', dir: 'database' } }));
    mkdirSync(join(root, 'users', 'synthetic', 'high_freq')); writeFileSync(join(root, 'users', 'synthetic', 'high_freq', 'database.md'), '数据库高频问答');
    const hash = () => createHash('sha256').update(readFileSync(path)).digest('hex'), before = hash();
    execFileSync(process.execPath, [resolve('scripts/export-legacy.ts'), '--db', path, '--user', 'synthetic', '--out', output, '--with-knowledge'], { stdio: 'pipe' });
    assert.equal(hash(), before);
    const backup = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(backup.sessions.length, 3); assert.equal(backup.materials.length, 2); assert.ok(!JSON.stringify(backup).includes('SHOULD_NEVER_EXPORT'));
    assert.equal(backup.topics[0].name, '数据库');
    assert.deepEqual(backup.materials.map((item: {knowledgeSection: string}) => item.knowledgeSection), ['core', 'questions']);
    assert.equal(backup.materials[0].topicId, backup.materials[1].topicId);
    const store = new Store(':memory:'); const preview = previewImport(backup, store);
    assert.equal(preview.sessions.find(session => session.role === '后端实习生')?.materials[0].text, '历史冻结材料');
    assert.equal(preview.sessions.find(session => session.role === '后端实习生')?.turns[0].answer, '合成答案'); store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { PracticeService } from '../src/service.ts';
import { KnowledgeLibrary } from '../src/knowledge.ts';
import { defaultSettings } from '../src/model.ts';
import type { Job, Session } from '../src/model.ts';

function fixture() {
  const store = new Store(':memory:');
  store.setSettings({ ...defaultSettings, baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'synthetic-only' });
  new KnowledgeLibrary(store).initialize();
  const calls: { finish: (output: string) => void; signal: AbortSignal; write: (text: string) => void }[] = [];
  const service = new PracticeService(store, async (_settings, _messages, signal, write) => new Promise<string>(finish => {
    calls.push({ finish, signal, write }); write('已生成片段');
  }));
  const session = service.create({ title: '合成面试', role: '后端', mode: 'coach', materialIds: [] });
  const interview = (requestId = 'interview') => service.job(session.id, { kind: 'next', requestId });
  const knowledge = (requestId = 'knowledge') => service.knowledgeJob('topic-java', { section: 'core', requestId });
  const cleanup = async () => {
    for (const call of calls) call.finish('测试清理');
    await service.close(); store.close();
  };
  return { store, service, session, calls, interview, knowledge, cleanup };
}

test('in-flight requests are reused while interview and knowledge generation remain independent', async () => {
  const { store, service, calls, interview, knowledge, cleanup } = fixture();
  try {
    const question = interview(), study = knowledge();
    assert.equal(interview().id, question.id); assert.equal(knowledge().id, study.id);
    assert.equal(calls.length, 2);
    assert.throws(() => interview('other'), /已有生成任务/);
    assert.throws(() => knowledge('other'), /已有生成任务/);
    service.cancel(question.id);
    calls[0].write('取消后迟到的片段'); calls[0].finish('取消后迟到的问题');
    calls[1].finish('独立完成的知识补充');
    await Promise.all(service.pending);
    assert.equal(store.require<Job>('jobs', question.id).status, 'cancelled');
    assert.equal(store.require<Job>('jobs', question.id).draft, '已生成片段');
    const completed = store.require<Job>('jobs', study.id);
    assert.equal(completed.status, 'succeeded'); assert.ok(completed.materialId);
    assert.equal(store.list('materials').length, 25);
  } finally { await cleanup(); }
});

test('shutdown interrupts both job types, preserves drafts and refuses new generation', async () => {
  const { store, service, session, calls, interview, knowledge, cleanup } = fixture();
  try {
    const jobs = [interview(), knowledge()], originalMaterials = store.list('materials');
    const closing = service.close();
    assert.ok(calls.every(call => call.signal.aborted));
    assert.throws(() => interview('new'), /服务正在退出/);
    assert.throws(() => knowledge('new'), /服务正在退出/);
    for (const call of calls) { call.write('退出后迟到的片段'); call.finish('退出后迟到的结果'); }
    await closing;
    for (const job of jobs) {
      const saved = store.require<Job>('jobs', job.id);
      assert.equal(saved.status, 'interrupted'); assert.equal(saved.draft, '已生成片段');
      assert.ok(saved.firstTokenMs !== undefined); assert.ok(saved.elapsedMs !== undefined);
    }
    assert.equal(service.pending.size, 0);
    assert.equal(store.require<Session>('sessions', session.id).turns.length, 0);
    assert.deepEqual(store.list('materials'), originalMaterials);
  } finally { await cleanup(); }
});

test('late interview output cannot overwrite an independently updated session', async () => {
  const { store, service, session, calls, interview, cleanup } = fixture();
  try {
    const job = interview();
    const changed = store.require<Session>('sessions', session.id);
    changed.title = '另一次操作保存的标题'; store.saveSession(changed);
    calls[0].finish('过期的问题'); await Promise.all(service.pending);
    assert.equal(store.require<Job>('jobs', job.id).status, 'failed');
    assert.match(store.require<Job>('jobs', job.id).error!, /会话版本已变化/);
    assert.deepEqual(store.require('sessions', session.id), changed);
  } finally { await cleanup(); }
});

test('a failed completion write rolls back domain results and leaves no phantom material reference', async () => {
  const { store, service, session, calls, interview, knowledge, cleanup } = fixture();
  try {
    const jobs = [interview(), knowledge()], originalSession = store.require('sessions', session.id), originalMaterials = store.list('materials');
    store.db.exec(`CREATE TRIGGER reject_completion BEFORE UPDATE ON records
      WHEN NEW.collection = 'jobs' AND json_extract(NEW.value, '$.status') = 'succeeded'
      BEGIN SELECT RAISE(ABORT, 'synthetic completion write failed'); END;`);
    for (const call of calls) call.finish('完整结果');
    await Promise.all(service.pending);
    for (const job of jobs) {
      const saved = store.require<Job>('jobs', job.id);
      assert.equal(saved.status, 'failed'); assert.match(saved.error!, /completion write failed/);
      assert.equal(saved.materialId, undefined);
    }
    assert.deepEqual(store.require('sessions', session.id), originalSession);
    assert.deepEqual(store.list('materials'), originalMaterials);
  } finally { await cleanup(); }
});

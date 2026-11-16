import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { PracticeService } from '../src/service.ts';
import { defaultSettings as emptySettings, settingsFrom } from '../src/model.ts';
import type { Job, Session } from '../src/model.ts';
import { messages } from '../src/prompts.ts';
import { commitImport, previewImport } from '../src/migration.ts';

const defaultSettings = { ...emptySettings, baseUrl: 'https://api.example.com/v1', model: 'gpt-6.1-sol', effort: 'xhigh' };

function setup(output = '请说明你在项目中负责的内容。') {
  const store = new Store(':memory:'); store.setSettings({ ...defaultSettings, apiKey: 'test-only' });
  let calls = 0;
  const service = new PracticeService(store, async (_, __, ___, onText) => { calls++; onText(output); return output; });
  const material = service.material({ title: '合成项目', kind: 'project', text: '实现版本快照；没有测量性能。' });
  const session = service.create({ title: '测试面试', role: '后端工程师', mode: 'strict', materialIds: [material.id] });
  return { store, service, material, session, calls: () => calls };
}
async function wait(service: PracticeService) { await Promise.all(service.pending); }
async function answered(mode: 'strict' | 'coach' = 'strict') {
  const context = setup();
  if (mode === 'coach') { context.session.mode = 'coach'; context.store.put('sessions', context.session); }
  context.service.job(context.session.id, { kind: 'next', requestId: 'first' }); await wait(context.service);
  const session = context.store.require<Session>('sessions', context.session.id);
  context.service.answer(session.id, { turnId: session.turns[0].id, answer: '我实现了版本快照。', revision: session.revision });
  return context;
}
test('editing material uses revision conflict protection and immutable session snapshot', () => {
  const { service, store, material, session } = setup();
  service.material({ title: '新标题', kind: 'project', text: '新内容', revision: 1 }, material.id);
  assert.throws(() => service.material({ title: '旧编辑', kind: 'project', text: '过期', revision: 1 }, material.id), /已更新/);
  assert.equal(store.require<Session>('sessions', session.id).materials[0].text, '实现版本快照；没有测量性能。');
  assert.equal(store.list('materials').length, 1); store.close();
});
test('deleted material remains available in old session evidence', () => {
  const { store, material, session } = setup(); store.delete('materials', material.id);
  assert.equal(store.require<Session>('sessions', session.id).materials.length, 1); store.close();
});
test('job idempotency replays successful result and rejects changed payload', async () => {
  const { store, service, session, calls } = setup();
  const first = service.job(session.id, { kind: 'next', requestId: 'same' }); await wait(service);
  const repeated = service.job(session.id, { kind: 'next', requestId: 'same' });
  assert.equal(repeated.id, first.id); assert.equal(repeated.status, 'succeeded'); assert.equal(calls(), 1);
  assert.throws(() => service.job(session.id, { kind: 'review', requestId: 'same' }), /不同内容/); store.close();
});
test('new questions wait for answer and original answer is never overwritten', async () => {
  const { store, service, session } = setup(); service.job(session.id, { kind: 'next', requestId: 'first' }); await wait(service);
  let current = store.require<Session>('sessions', session.id);
  assert.throws(() => service.job(session.id, { kind: 'next', requestId: 'second' }), /先回答/);
  service.answer(session.id, { turnId: current.turns[0].id, answer: '原回答', revision: current.revision });
  current = store.require<Session>('sessions', session.id);
  assert.throws(() => service.answer(session.id, { turnId: current.turns[0].id, answer: '覆盖', revision: current.revision }), /重复作答/);
  assert.equal(current.turns[0].answer, '原回答'); store.close();
});
test('strict simulation does not leak reference before completion', async () => {
  const { store, service, session } = await answered(); const turn = store.require<Session>('sessions', session.id).turns[0];
  assert.throws(() => service.job(session.id, { kind: 'reference', turnId: turn.id, requestId: 'ref' }), /严格模拟结束/);
  service.complete(session.id); service.job(session.id, { kind: 'reference', turnId: turn.id, requestId: 'ref' }); await wait(service);
  assert.ok(store.require<Session>('sessions', session.id).turns[0].reference); store.close();
});
test('coach can request reference and save comparison without changing original', async () => {
  const { store, service, session } = await answered('coach'); let current = store.require<Session>('sessions', session.id);
  service.job(session.id, { kind: 'reference', turnId: current.turns[0].id, requestId: 'ref' }); await wait(service);
  service.job(session.id, { kind: 'compare', turnId: current.turns[0].id, answer: '新回答', requestId: 'retry' }); await wait(service);
  current = store.require<Session>('sessions', session.id);
  assert.equal(current.turns[0].answer, '我实现了版本快照。'); assert.equal(current.turns[0].attempts[0].text, '新回答'); store.close();
});
test('invalid material citations cause failed job, not accepted reference', async () => {
  const { store, service, session } = setup('参考内容 [M99]'); service.job(session.id, { kind: 'next', requestId: 'first' }); await wait(service);
  assert.equal(store.list<Job>('jobs')[0].status, 'failed'); assert.equal(store.require<Session>('sessions', session.id).turns.length, 0); store.close();
});
test('model failure saves draft and retry uses same logical job', async () => {
  const store = new Store(':memory:'); store.setSettings({ ...defaultSettings, apiKey: 'private-key' }); let fail = true;
  const service = new PracticeService(store, async (_, __, ___, onText) => { onText('已生成片段'); if (fail) throw new Error('failure private-key'); return '完整问题'; });
  const session = service.create({ title: '测试', role: '后端', mode: 'strict', materialIds: [] });
  const job = service.job(session.id, { kind: 'next', requestId: 'first' }); await wait(service);
  let current = store.require<Job>('jobs', job.id);
  assert.equal(current.draft, '已生成片段'); assert.equal(current.status, 'failed'); assert.ok(!current.error?.includes('private-key'));
  fail = false; service.job(session.id, { kind: 'next', requestId: 'first' }); await wait(service);
  current = store.require<Job>('jobs', job.id); assert.equal(current.attempt, 2); assert.equal(current.status, 'succeeded'); store.close();
});
test('running generation blocks concurrent answer, completion and another job', async () => {
  const store = new Store(':memory:'); store.setSettings({ ...defaultSettings, apiKey: 'test' });
  let release!: () => void;
  const service = new PracticeService(store, async () => { await new Promise<void>(resolve => { release = resolve; }); return '下一题'; });
  const session = service.create({ title: '测试', role: '后端', mode: 'strict', materialIds: [] });
  service.job(session.id, { kind: 'next', requestId: 'first' });
  assert.throws(() => service.job(session.id, { kind: 'next', requestId: 'second' }), /已有生成任务/);
  assert.throws(() => service.complete(session.id), /当前生成/);
  assert.throws(() => service.answer(session.id, { answer: 'x' }), /当前生成/);
  release(); await wait(service); store.close();
});
test('cancelled generation cannot append a question even if gateway resolves', async () => {
  const store = new Store(':memory:'); store.setSettings({ ...defaultSettings, apiKey: 'test' }); let release!: () => void;
  const service = new PracticeService(store, async () => { await new Promise<void>(resolve => { release = resolve; }); return '迟到的问题'; });
  const session = service.create({ title: '测试', role: '后端', mode: 'strict', materialIds: [] });
  const job = service.job(session.id, { kind: 'next', requestId: 'first' }); service.cancel(job.id); release(); await wait(service);
  assert.equal(store.require<Job>('jobs', job.id).status, 'cancelled'); assert.equal(store.require<Session>('sessions', session.id).turns.length, 0); store.close();
});
test('restart preserves history and marks abandoned job interrupted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interview-v2-')); const path = join(dir, 'test.db');
  try {
    const store = new Store(path);
    const service = new PracticeService(store); const session = service.create({ title: '重启测试', role: '后端', mode: 'strict', materialIds: [] });
    store.put('jobs', { id: 'abandoned', sessionId: session.id, status: 'running', draft: '片段' }); store.close();
    const reopened = new Store(path); new PracticeService(reopened);
    assert.equal(reopened.require<Session>('sessions', session.id).title, '重启测试');
    assert.equal(reopened.require<Job>('jobs', 'abandoned').status, 'interrupted'); assert.equal(reopened.require<Job>('jobs', 'abandoned').draft, '片段'); reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('settings retain explicit model, effort and key while validating unsafe inputs', () => {
  const previous = { ...defaultSettings, apiKey: 'secret' };
  const next = settingsFrom({ ...defaultSettings, apiKey: undefined }, previous);
  assert.equal(next.apiKey, 'secret'); assert.equal(next.model, 'gpt-6.1-sol'); assert.equal(next.effort, 'xhigh');
  assert.throws(() => settingsFrom({ ...defaultSettings, baseUrl: 'http://remote.example/v1' }, previous), /HTTPS/);
  assert.throws(() => settingsFrom({ ...defaultSettings, headers: { Host: 'evil' } }, previous), /请求头/);
  assert.throws(() => settingsFrom({ ...defaultSettings, headers: { x: 'a\r\nb' } }, previous), /请求头/);
});
test('prompts use frozen evidence and separate missing experience from suggestions', () => {
  const { store, session } = setup(); const value = messages(session, { kind: 'next' });
  assert.match(value[0].content, /\[M1\]/); assert.match(value[0].content, /不补造/); assert.match(value[1].content, /不提示答案/); store.close();
});
test('backup excludes keys, previews without mutations and deduplicates restore', () => {
  const { store } = setup(); const backup = store.export();
  assert.ok(!JSON.stringify(backup).includes('test-only'));
  const preview = previewImport(backup, store); assert.equal(preview.duplicates, 2); assert.equal(preview.materials.length, 0);
  const fresh = new Store(':memory:'); const before = previewImport(backup, fresh); assert.equal(fresh.list('materials').length, 0);
  assert.throws(() => commitImport(backup, 'wrong', fresh), /预览不一致/);
  commitImport(backup, before.fingerprint, fresh); assert.equal(fresh.list('materials').length, 1);
  assert.equal(previewImport(backup, fresh).duplicates, 2); store.close(); fresh.close();
});
test('malformed migration rolls back before any write and legacy transcript gets warning', () => {
  const store = new Store(':memory:'); const malformed = { format: 'interview-room-backup', version: 2, materials: [{ id: 'a', title: 'x', kind: 'project', text: 'text' }], sessions: [{ id: 'bad', turns: [{ question: null }] }] };
  assert.throws(() => previewImport(malformed, store)); assert.equal(store.list('materials').length, 0);
  const legacy = { format: 'interview-room-legacy-export', version: 1, sourceId: 'local', materials: [], sessions: [{ id: 's', topic: '项目', questions: '["介绍项目"]', transcript: '[{"role":"user","content":"我做了快照"}]' }] };
  const result = previewImport(legacy, store); assert.equal(result.sessions[0].turns[0].answer, '我做了快照'); assert.equal(result.sessions[0].status, 'completed'); assert.ok(result.warnings.length > 1); store.close();
});
test('resume import preserves empty-question transcripts, reference keys and retry history', () => {
  const store = new Store(':memory:');
  const backup = { format: 'interview-room-legacy-export', version: 1, sourceId: 'synthetic', materials: [], warnings: ['PDF 需重新上传'],
    sessions: [{ id: 'resume', mode: 'resume', questions: [], transcript: [
      { role: 'assistant', content: '介绍职责' }, { role: 'user', content: '我负责快照' },
      { role: 'assistant', content: '怎么验证' }, { role: 'user', content: '测试版本隔离' }],
      reference_answers: { 'resume-turn-1': '职责答法', 'resume-turn-3': '验证答法' },
      meta: { training_mode: 'coach', training_attempts: [{ question_id: 'resume-turn-3', answer: '补充并发测试', comparison: '更具体', created_at: '2026-11-16' }] } }] };
  const result = previewImport(backup, store), session = result.sessions[0];
  assert.equal(session.turns.length, 2); assert.equal(session.turns[1].answer, '测试版本隔离');
  assert.equal(session.turns[1].reference, '验证答法'); assert.equal(session.turns[1].attempts[0].text, '补充并发测试');
  assert.equal(session.mode, 'coach'); assert.ok(result.warnings.includes('PDF 需重新上传')); store.close();
});
test('legacy drill never shifts a later answer into an unanswered question', () => {
  const store = new Store(':memory:'); const backup = { format: 'interview-room-legacy-export', version: 1, sourceId: 'synthetic', materials: [],
    sessions: [{ id: 'drill', mode: 'topic_drill', questions: [{ id: 7, question: '第一题' }, { id: 9, question: '第二题' }],
      transcript: [{ role: 'assistant', content: '第一题' }, { role: 'assistant', content: '第二题' }, { role: 'user', content: '第二题的答案' }], reference_answers: { '9': '第二题答法' } }] };
  const result = previewImport(backup, store);
  assert.equal(result.sessions[0].turns[0].answer, undefined); assert.equal(result.sessions[0].turns[1].answer, '第二题的答案');
  assert.equal(result.sessions[0].turns[1].reference, '第二题答法'); store.close();
});
test('technical references adapt to the question without fixed length or personal-topic defaults', () => {
  const { store, session } = setup();
  try {
    session.turns.push({ id: 'technical', question: '解释数据库事务隔离级别。', answer: '隔离并发事务。', attempts: [] });
    const prompts = messages(session, { kind: 'reference', turnId: 'technical' });
    assert.match(prompts[1].content, /一般技术题直接解释机制和例子/);
    for (const kind of ['prepare', 'review', 'reference', 'compare'] as const) {
      const task = messages(session, { kind, turnId: 'technical', answer: '新的说明' })[1].content;
      assert.doesNotMatch(task, /最多\s*\d+\s*中文字|60.?90|下次三项|QNN|LoRA/);
    }
  } finally { store.close(); }
});

test('resume and JD have distinct prompt roles and multiple versions cannot mix', () => {
  const { store, service, material } = setup();
  const resume = service.material({ title: '简历', kind: 'resume', text: '我负责 Java 接口' });
  const other = service.material({ title: '旧简历', kind: 'resume', text: '旧版本' });
  const jd = service.material({ title: 'JD', kind: 'jd', text: '要求分布式经验' });
  const session = service.create({ title: '定向练习', role: 'Java 实习生', mode: 'strict', materialIds: [resume.id, jd.id, material.id] });
  const prompt = messages(session, { kind: 'next' });
  assert.match(prompt[0].content, /不能把 JD 的要求变成候选人的工作经历/);
  assert.match(prompt[1].content, /优先选 JD/); assert.equal(session.materials[0].kind, 'resume');
  assert.throws(() => service.create({ title: '混用', role: '后端', mode: 'strict', materialIds: [resume.id, other.id] }), /只选一份简历/);
  assert.throws(() => settingsFrom({ ...defaultSettings, baseUrl: 'broken' }, defaultSettings), /格式无效/); store.close();
});
test('preparation is explicit, saved before the interview and unavailable during strict answers', async () => {
  const { store, service, session } = setup();
  service.job(session.id, { kind: 'prepare', requestId: 'plan' }); await wait(service);
  assert.ok(store.require<Session>('sessions', session.id).preparation);
  assert.equal(store.require<Session>('sessions', session.id).turns.length, 0);
  service.job(session.id, { kind: 'next', requestId: 'first' }); await wait(service);
  assert.throws(() => service.job(session.id, { kind: 'prepare', requestId: 'later-plan' }), /开始答题前/); store.close();
});

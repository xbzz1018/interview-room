import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { KnowledgeLibrary } from '../src/knowledge.ts';
import { ModelProfiles } from '../src/model-profiles.ts';
import { PracticeService } from '../src/service.ts';
import { defaultSettings as emptySettings } from '../src/model.ts';
import type { Job, Material, ModelProfile, Session } from '../src/model.ts';
import { commitImport, previewImport } from '../src/migration.ts';
import { messages } from '../src/prompts.ts';

const defaultSettings = { ...emptySettings, baseUrl: 'https://api.example.com/v1', model: 'gpt-6.1-sol', effort: 'xhigh' };

test('new workspaces start without a private gateway, model or credentials', () => {
  const store = new Store(':memory:');
  try {
    new ModelProfiles(store).initialize();
    const settings = store.settings();
    assert.equal(settings.baseUrl, ''); assert.equal(settings.model, '');
    assert.equal(settings.effort, ''); assert.equal(settings.apiKey, '');
    assert.deepEqual(settings.headers, {});
  } finally { store.close(); }
});

function fixture() {
  const store = new Store(':memory:'); store.setSettings({ ...defaultSettings, apiKey: 'synthetic-original-key' });
  const library = new KnowledgeLibrary(store); library.initialize();
  const profiles = new ModelProfiles(store); profiles.initialize();
  return { store, library, profiles };
}
const input = { title: '领域训练', role: '后端', mode: 'coach', trainingKind: 'topic', topicId: 'topic-java', materialIds: [] };

const previousPythonOutline = `# Python

## 复习重点
从对象可变性解释引用和默认参数。迭代器、生成器和协程各有不同的生命周期。讨论 GIL 时明确解释器和运行模式；IO 并发与 CPU 并行应分别选择方案。

## 核心提纲
### 1. 对象与参数
变量绑定对象，对象有可变与不可变之分。浅拷贝只复制外层容器，嵌套对象仍可能共享。默认参数在函数定义时求值，避免把可变默认值当作每次调用的新对象。

### 2. 函数与资源
装饰器包装可调用对象，闭包保留所需环境。上下文管理器在退出路径释放资源，应同时覆盖正常返回、异常和取消。

### 3. 迭代与异步
生成器按需产生值，协程配合事件循环协调等待。async 函数不意味着其中所有操作都非阻塞；同步文件或网络库可能卡住事件循环。

### 4. 并发取舍
明确解释器版本与运行模式，再讨论 GIL。线程、进程和异步的代价不同；CPU 并行需要结合执行环境、扩展是否释放锁及进程通信成本判断。

### 5. 工程习惯
虚拟环境隔离依赖，记录 Python 与依赖版本。日志按请求关联，测试覆盖正常、异常和取消；先测 IO、计算与排队耗时，再决定优化方向。

## 试着讲清楚
- 可变默认参数为什么会在多次调用间共享？
- 异步函数里执行阻塞 IO 会怎样？
- 任务取消后如何释放连接和文件？

## 自检
每个要点讲清原理、适用条件和一个例子；不确定的版本行为再查文档。`;

test('fresh library contains 12 ordered general domains, 24 editable files and 48 answered questions, without candidate projects', () => {
  const { store, library } = fixture();
  try {
    assert.deepEqual(library.list().slice(0, 3).map(item => item.name), ['Java', 'Python', 'JavaScript']);
    assert.equal(library.list().length, 12);
    const notes = store.list<Material>('materials'); assert.equal(notes.length, 24);
    assert.ok(notes.every(item => item.kind === 'notes' && item.topicId && item.knowledgeSection));
    assert.equal(notes.filter(item => item.knowledgeSection === 'questions').reduce((n, item) => n + [...item.text.matchAll(/\*\*参考答题要点\*\*/g)].length, 0), 48);
    assert.equal(notes.filter(item => item.knowledgeSection === 'core').length, 12);
    assert.ok(notes.filter(item => item.knowledgeSection === 'core').every(item => item.text.length < 1000 && item.title.endsWith('快速提纲')));
    library.initialize(); assert.equal(store.list('materials').length, 24);
  } finally { store.close(); }
});

test('deleting a domain preserves files and historical evidence, and does not reseed after restart', () => {
  const { store, library } = fixture(); const service = new PracticeService(store);
  try {
    const session = service.create(input), original = session.materials.map(item => item.text);
    const note = store.require<Material>('materials', 'starter-java-core');
    service.material({ ...note, text: '修改后知识' }, note.id);
    assert.deepEqual(store.require<Session>('sessions', session.id).materials.map(item => item.text), original);
    library.remove('topic-java'); library.initialize();
    assert.equal(library.list().length, 11);
    assert.equal(store.require<Material>('materials', note.id).topicId, undefined);
    assert.equal(store.require<Session>('sessions', session.id).topicName, 'Java');
  } finally { store.close(); }
});

test('existing starter copy refresh preserves user additions, custom notes and historical snapshots', () => {
  const { store, library } = fixture(); const service = new PracticeService(store);
  try {
    const notice = '性质：内置学习提纲，不代表本人实习或项目经历；可继续编辑补充。';
    const original = store.require<Material>('materials', 'starter-java-core');
    const legacy = { ...original, text: original.text.replace('# Java\n\n', `# Java\n${notice}\n\n`) + '\n\n我的补充：事务重试需要幂等。', revision: 7 };
    store.put('materials', legacy);
    const question = store.require<Material>('materials', 'starter-java-questions');
    store.put('materials', { ...question, text: question.text.replace('# Java\n\n', `# Java\n${notice}\n\n`) });
    const custom = service.material({ title: '我的笔记', kind: 'notes', text: legacy.text });
    const session = service.create(input), history = structuredClone(session);
    store.delete('materials', 'starter-python-core');
    library.initialize();
    const updated = store.require<Material>('materials', legacy.id);
    assert.equal(updated.text, original.text + '\n\n我的补充：事务重试需要幂等。');
    assert.equal(updated.revision, 8);
    assert.equal(store.require<Material>('materials', question.id).text, question.text);
    assert.deepEqual(store.require('materials', custom.id), custom);
    assert.deepEqual(store.require('sessions', session.id), history);
    assert.equal(store.get('materials', 'starter-python-core'), undefined);
    library.initialize(); assert.deepEqual(store.require('materials', legacy.id), updated);
  } finally { store.close(); }
});

test('outline upgrade replaces only untouched shipped content and preserves historical evidence', () => {
  const { store, library } = fixture(); const service = new PracticeService(store);
  try {
    const original = store.require<Material>('materials', 'starter-python-core');
    const legacy = { ...original, text: previousPythonOutline, revision: 4 };
    store.put('materials', legacy);
    const session = service.create({ ...input, topicId: 'topic-python' });
    const history = structuredClone(session), profiles = store.list('profiles'), settings = store.settings();
    library.initialize();
    const upgraded = store.require<Material>('materials', legacy.id);
    assert.equal(upgraded.text, original.text); assert.equal(upgraded.revision, 5);
    assert.deepEqual(store.require('sessions', session.id), history);
    assert.deepEqual(store.settings(), settings); assert.deepEqual(store.list('profiles'), profiles);
    library.initialize(); assert.deepEqual(store.require('materials', legacy.id), upgraded);
    for (const override of [{ text: previousPythonOutline + '\n我的补充' }, { title: '我的 Python 笔记' }, { topicId: undefined }, { knowledgeSection: 'questions' as const }]) {
      const edited = { ...legacy, ...override }; if (edited.topicId === undefined) delete edited.topicId;
      store.put('materials', edited); library.initialize();
      assert.deepEqual(store.require('materials', legacy.id), edited);
    }
    store.delete('materials', legacy.id); library.initialize();
    assert.equal(store.get('materials', legacy.id), undefined);
  } finally { store.close(); }
});

test('focused practice freezes only selected domain knowledge and rejects mismatched or oversized evidence', () => {
  const { store } = fixture(); const service = new PracticeService(store);
  try {
    const session = service.create({ ...input, knowledgeIds: ['starter-java-questions'] });
    assert.equal(session.materials.length, 1); assert.equal(session.materials[0].knowledgeSection, 'questions');
    const prompt = messages(session, { kind: 'next' })[0].content;
    assert.match(prompt, /Java.*专项训练/); assert.match(prompt, /知识材料不是候选人的工作经历/);
    assert.throws(() => service.create({ ...input, knowledgeIds: ['starter-python-core'] }), /不属于/);
    assert.equal(service.create({ ...input, knowledgeIds: [] }).materials.length, 0);
    service.material({ title: '过大内容', kind: 'notes', topicId: 'topic-java', text: '字'.repeat(59000) });
    assert.throws(() => service.create(input), /60000/);
  } finally { store.close(); }
});

test('knowledge generation creates an additional file, caches identical requests, and keeps original files', async () => {
  const { store } = fixture(); let calls = 0;
  const service = new PracticeService(store, async (_settings, prompts, _signal, onText) => {
    calls++; assert.match(prompts[1].content, /高频题库/); onText('新的题目'); return '新的题目与参考要点';
  });
  try {
    const original = store.require<Material>('materials', 'starter-java-questions');
    const job = service.knowledgeJob('topic-java', { section: 'questions', requestId: 'same' }); await Promise.all(service.pending);
    const completed = store.require<Job>('jobs', job.id); assert.equal(completed.status, 'succeeded'); assert.ok(completed.materialId);
    assert.equal(store.list('materials').length, 25);
    assert.deepEqual(store.require('materials', original.id), original);
    assert.equal(service.knowledgeJob('topic-java', { section: 'questions', requestId: 'same' }).id, job.id); assert.equal(calls, 1);
    assert.throws(() => service.knowledgeJob('topic-java', { section: 'core', requestId: 'same' }), /不同内容/);
  } finally { await service.close(); store.close(); }
});

test('cancelled knowledge job rejects late success; changed domain version rejects stale output', async () => {
  const { store, library } = fixture(); let finish!: (value: string) => void;
  const service = new PracticeService(store, async (_s, _m, _a, onText) => { onText('部分'); return await new Promise<string>(resolve => { finish = resolve; }); });
  try {
    const job = service.knowledgeJob('topic-java', { section: 'core', requestId: 'cancel' });
    assert.throws(() => library.remove('topic-java'), /取消/);
    service.cancel(job.id); finish('迟到结果'); await Promise.all(service.pending);
    assert.equal(store.require<Job>('jobs', job.id).status, 'cancelled'); assert.equal(store.list('materials').length, 24);
    const retry = service.knowledgeJob('topic-java', { section: 'core', requestId: 'cancel' });
    const topic = library.list().find(item => item.id === 'topic-java')!; library.topic({ ...topic, name: 'Java 深入' }, topic.id);
    finish('旧版本输出'); await Promise.all(service.pending);
    assert.equal(retry.attempt, 2); assert.equal(store.require<Job>('jobs', job.id).status, 'failed');
    assert.match(store.require<Job>('jobs', job.id).error!, /领域已修改/); assert.equal(store.list('materials').length, 24);
  } finally { await service.close(); store.close(); }
});

test('profile migration preserves original connection and keeps each credential independent and private', () => {
  const { store, profiles } = fixture();
  try {
    assert.equal(store.settings().model, 'gpt-6.1-sol'); assert.equal(store.settings().effort, 'xhigh');
    assert.equal(store.settings().apiKey, 'synthetic-original-key');
    const second = profiles.save({ name: 'DeepSeek 练习', provider: 'deepseek', connection: { ...defaultSettings, protocol: 'chat', effort: '', apiKey: undefined, tokenParameter: 'max_tokens' } });
    assert.equal(second.connection.hasApiKey, false);
    assert.equal(store.require<ModelProfile>('profiles', second.id).connection.apiKey, '');
    profiles.activate(second.id); assert.equal(store.settings().protocol, 'chat');
    const updated = profiles.save({ ...second, connection: { ...second.connection, apiKey: 'synthetic-second-key' } }, second.id);
    assert.equal(updated.connection.hasApiKey, true);
    const kept = profiles.save({ ...updated, connection: { ...updated.connection, apiKey: undefined } }, second.id);
    assert.equal(store.settings().apiKey, 'synthetic-second-key');
    assert.throws(() => profiles.save({ ...updated, connection: updated.connection }, second.id), /已更新/);
    profiles.save({ ...kept, connection: { ...kept.connection, apiKey: '' } }, second.id); assert.equal(store.settings().apiKey, '');
    assert.throws(() => profiles.remove(second.id), /先启用/);
    profiles.activate('profile-default'); profiles.remove(second.id);
    assert.equal(store.settings().apiKey, 'synthetic-original-key');
    assert.doesNotMatch(JSON.stringify(profiles.list()), /synthetic-original-key|apiKey"/);
    assert.doesNotMatch(JSON.stringify(store.export()), /synthetic-original-key|profiles|apiKey/);
  } finally { store.close(); }
});

test('changing theme neither edits a connection nor conflicts with an open model editor', () => {
  const { store, profiles } = fixture();
  try {
    const before = profiles.list().profiles[0]; store.setTheme('forest');
    assert.deepEqual(profiles.list().profiles[0], before); assert.equal(store.settings().theme, 'forest');
    profiles.save({ ...before, name: '原配置改名' }, before.id);
    profiles.activate(before.id); assert.equal(store.settings().theme, 'forest');
  } finally { store.close(); }
});

test('removed theme falls back to ink without rewriting the stored model connection', () => {
  const { store } = fixture();
  try {
    const original = store.settings();
    const raw = JSON.stringify({ ...original, theme: 'wine' });
    store.db.prepare('UPDATE config SET value=? WHERE id=1').run(raw);
    assert.equal(store.settings().theme, 'ink');
    const { theme: _old, ...connection } = original;
    const { theme: _new, ...actual } = store.settings();
    assert.deepEqual(actual, connection);
    assert.equal(store.db.prepare('SELECT value FROM config WHERE id=1').get()?.value, raw);
  } finally { store.close(); }
});

test('switching profiles during generation preserves its captured model and sanitizes the original key', async () => {
  const { store, profiles } = fixture(); let fail!: (error: Error) => void; let captured = '';
  const service = new PracticeService(store, async (settings) => { captured = settings.model; return new Promise<string>((_resolve, reject) => { fail = reject; }); });
  try {
    const session = service.create(input), job = service.job(session.id, { kind: 'next', requestId: 'snapshot' });
    const second = profiles.save({ name: '另一模型', provider: 'custom', connection: { ...defaultSettings, model: 'synthetic-other', apiKey: 'other-key' } }); profiles.activate(second.id);
    fail(new Error('failed synthetic-original-key')); await Promise.all(service.pending);
    assert.equal(captured, 'gpt-6.1-sol');
    const saved = store.require<Job>('jobs', job.id); assert.equal(saved.model, captured); assert.equal(saved.profileId, 'profile-default');
    assert.doesNotMatch(saved.error!, /synthetic-original-key/);
    assert.equal(store.settings().model, 'synthetic-other');
  } finally { await service.close(); store.close(); }
});

test('backup round-trip preserves domains, both knowledge categories and historical focused snapshots, excluding connections', () => {
  const { store } = fixture(), restored = new Store(':memory:'); const service = new PracticeService(store);
  try {
    const session = service.create(input), backup = store.export(), preview = previewImport(backup, restored);
    assert.equal(preview.topics.length, 12); assert.equal(restored.list('topics').length, 0);
    commitImport(backup, preview.fingerprint, restored);
    const archived = restored.require<Session>('sessions', session.id);
    assert.equal(archived.topicName, 'Java'); assert.equal(archived.status, 'completed');
    assert.deepEqual(archived.materials.map(item => [item.text, item.topicId, item.knowledgeSection]), session.materials.map(item => [item.text, item.topicId, item.knowledgeSection]));
    assert.equal(restored.require<Material>('materials', 'starter-java-questions').knowledgeSection, 'questions');
    assert.equal(previewImport(backup, restored).materials.length, 0); assert.equal(previewImport(backup, restored).topics.length, 0);
    assert.equal(restored.list('profiles').length, 0);
  } finally { restored.close(); store.close(); }
});

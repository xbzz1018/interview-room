import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { PracticeService } from '../src/service.ts';
import { createApplication } from '../src/server.ts';

test('HTTP boundary protects local data, validates body and persists complete interview flow', async () => {
  const store = new Store(':memory:'); const service = new PracticeService(store, async () => '请说明设计取舍。');
  const app = createApplication(store, service);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url + '/api/materials')).status, 401);
    assert.equal((await fetch(url + '/api/materials', { headers: { Authorization: `Bearer ${'é'.repeat(64)}` } })).status, 401);
    assert.equal((await fetch(url + '/api/bootstrap', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const { token } = await (await fetch(url + '/api/bootstrap')).json();
    const request = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(url + '/api' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const settings = (await request('/settings')).body;
    assert.equal((await request('/settings', 'PUT', { ...settings, baseUrl: 'https://api.example.com/v1', model: 'synthetic-model', apiKey: 'do-not-leak' })).status, 200);
    assert.ok(!JSON.stringify((await request('/settings')).body).includes('do-not-leak'));
    assert.ok(!JSON.stringify((await request('/profiles')).body).includes('do-not-leak'));
    const firstProfile = (await request('/profiles')).body.profiles[0];
    assert.equal((await request('/theme', 'PUT', { theme: 'forest' })).status, 200);
    assert.equal((await request('/profiles')).body.profiles[0].revision, firstProfile.revision);
    assert.equal((await request('/settings')).body.model, 'synthetic-model');
    const topics = (await request('/topics')).body; assert.equal(topics.length, 12); assert.equal(topics[0].name, 'Java');
    const topic = (await request('/topics', 'POST', { name: 'HTTP 合成领域', description: '测试' })).body;
    const note = (await request('/materials', 'POST', { title: '合成核心', kind: 'notes', topicId: topic.id, knowledgeSection: 'core', text: '可编辑知识' })).body;
    const focused = (await request('/sessions', 'POST', { title: 'HTTP 专项', role: '后端', mode: 'coach', trainingKind: 'topic', topicId: topic.id, materialIds: [] })).body;
    assert.equal(focused.materials[0].text.includes('可编辑知识'), true);
    assert.equal((await request(`/topics/${topic.id}/jobs`, 'POST', { section: 'questions', requestId: 'http-study' })).status, 202); await Promise.all(service.pending);
    assert.equal((await request(`/topics/${topic.id}/jobs`)).body[0].status, 'succeeded');
    assert.equal((await request(`/topics/${topic.id}`, 'DELETE')).status, 200);
    assert.equal((await request('/materials')).body.find((item: {id: string}) => item.id === note.id).topicId, undefined);
    assert.equal((await request('/materials', 'POST', { title: 'bad', kind: 'x', text: 'x' })).status, 400);
    const material = (await request('/materials', 'POST', { title: '项目', kind: 'project', text: '合成资料' })).body;
    const session = (await request('/sessions', 'POST', { title: '练习', role: '后端', mode: 'strict', materialIds: [material.id] })).body;
    await request(`/sessions/${session.id}/jobs`, 'POST', { kind: 'next', requestId: 'first' }); await Promise.all(service.pending);
    const current = (await request(`/sessions/${session.id}`)).body;
    assert.equal(current.turns.length, 1);
    assert.equal((await request(`/sessions/${session.id}/answer`, 'POST', { turnId: current.turns[0].id, answer: '我的回答', revision: current.revision })).status, 200);
    await request(`/sessions/${session.id}/complete`, 'POST', {});
    const review = await request(`/sessions/${session.id}/jobs`, 'POST', { kind: 'review', requestId: 'review' }); assert.equal(review.status, 202); await Promise.all(service.pending);
    assert.equal((await request(`/sessions/${session.id}`)).body.review, '请说明设计取舍。');
    const backup = await request('/export'); assert.ok(!JSON.stringify(backup).includes('do-not-leak'));
    const invalid = await fetch(url + '/api/materials', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{invalid' }); assert.equal(invalid.status, 400);
    assert.equal((await request('/extract', 'POST', { type: 'image', base64: 'x' })).status, 400);
  } finally { await service.close(); await new Promise<void>(resolve => app.server.close(() => resolve())); store.close(); }
});

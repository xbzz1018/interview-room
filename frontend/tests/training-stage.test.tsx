import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RetryAnswer, PracticeProgress } from '../src/components/InterviewPractice';
import Review from '../src/pages/Review';
import AuthContext from '../src/contexts/AuthContextBase';

const browser = new GlobalWindow({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, sessionStorage: browser.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const originalFetch = globalThis.fetch;
let root: Root | undefined;
const attempt = { attempt_id: 'request-1', question_id: 'resume-turn-1', question: '怎么验证？', answer: '重答原文', original_answer: '原始回答', comparison: '改善了结构', technical_gaps: [{ point: '缺少并发验证', evidence: '重答原文', exercise: '编写并发测试' }], expression_gaps: [], created_at: '2026-11-09T10:00:00.000Z', assisted: true as const };
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; globalThis.fetch = originalFetch; });
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
async function mount(component: React.ReactNode, entry = '/') { const host = document.createElement('main'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<MemoryRouter initialEntries={[entry]}>{component}</MemoryRouter>)); }
async function click(text: string) { await act(async () => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent === text); if (!button) throw new Error('Missing button: ' + text); button.click(); }); }

test('retrying a failed comparison reuses its request ID and restores the saved attempt after reopen', async () => {
  const bodies: Array<{ request_id: string }> = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? new Response(JSON.stringify({ detail: '临时错误' }), { status: 502 }) : new Response(JSON.stringify(attempt));
  }) as typeof fetch;
  sessionStorage.setItem('practice::qa:resume-turn-1', JSON.stringify({ text: '重答原文' }));
  await mount(<RetryAnswer sessionId="qa" questionId="resume-turn-1" />);
  const input = document.querySelector('textarea')!;
  await click('保存并对比');
  expect(input.value).toBe('重答原文');
  await click('重试对比');
  expect(bodies[0]?.request_id).toBe(bodies[1]?.request_id);
  expect(document.body.textContent).toContain('缺少并发验证');
  expect(document.body.textContent).toContain('改善了结构');
  await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = '';
  await mount(<RetryAnswer sessionId="qa" questionId="resume-turn-1" attempts={[attempt]} />);
  expect(document.body.textContent).toContain('改善了结构');
  expect(bodies).toHaveLength(2);
});

test('practice history separates technical and expression observations with source links', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ items: [{ ...attempt, session_id: 'qa', training_mode: 'strict' }] }))) as typeof fetch;
  await mount(<PracticeProgress />);
  expect(document.body.textContent).toContain('缺少并发验证');
  expect(document.body.textContent).toContain('表达练习');
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/review/qa');
});

test('review displays a partial report, background sync and an isolated retry, then returns to material selection', async () => {
  let response = { session_id: 'qa', mode: 'resume', status: 'reviewing', review: '# 报告首段', meta: { review_stage: 'generating', profile_sync_pending: false, profile_extract_failed: false } };
  const requests: string[] = [];
  globalThis.fetch = (async (url) => { requests.push(String(url)); return new Response(JSON.stringify(response)); }) as typeof fetch;
  const auth = { user: null, token: null, loading: false, verificationError: null, retryVerification() {}, needsOnboarding: false, setNeedsOnboarding() {}, login() {}, logout() {} };
  await mount(<AuthContext.Provider value={auth}><Routes><Route path="/review/:sessionId" element={<Review />} /><Route path="/mock-interview" element={<p>选择本轮材料</p>} /></Routes></AuthContext.Provider>, '/review/qa');
  expect(document.body.textContent).toContain('报告首段');
  expect(document.body.textContent).toContain('正在生成报告');
  response = { ...response, status: 'reviewed', review: '# 正文已保存', meta: { ...response.meta, review_stage: 'syncing_profile', profile_sync_pending: true } };
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
  expect(document.body.textContent).toContain('正文已保存');
  expect(document.body.textContent).toContain('画像正在后台同步');
  response = { ...response, meta: { ...response.meta, review_stage: 'profile_failed', profile_sync_pending: false, profile_extract_failed: true } };
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
  expect(document.body.textContent).toContain('只重试画像同步');
  expect(document.body.textContent).toContain('正文已保存');
  await click('选择资料再练一轮');
  expect(document.body.textContent).toContain('选择本轮材料');
  expect(requests.every(url => url === '/api/interview/review/qa')).toBeTrue();
});

test('retired media reviews show saved text without regeneration or model calls', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ mode: 'recording', status: 'review_failed', review: '# 历史报告正文', questions: [], scores: [], transcript: [{ role: 'user', content: '历史回答原文' }], overall: {}, meta: { profile_extract_failed: true, profile_sync_pending: true } }));
  }) as typeof fetch;
  await mount(<AuthContext.Provider value={{ user: null, token: 'test-token', loading: false, verificationError: null, retryVerification() {}, needsOnboarding: false, setNeedsOnboarding() {}, login() {}, logout() {} }}><Routes><Route path="/review/:sessionId" element={<Review />} /></Routes></AuthContext.Provider>, '/review/legacy');
  expect(document.body.textContent).toContain('历史报告正文');
  expect(document.body.textContent).toContain('历史回答原文');
  expect(document.body.textContent).toContain('仅展示已保存内容');
  expect([...document.querySelectorAll('button')].some(button => /重试|再次练习|参考答法/.test(button.textContent || ''))).toBe(false);
  expect(calls).toHaveLength(1);
});

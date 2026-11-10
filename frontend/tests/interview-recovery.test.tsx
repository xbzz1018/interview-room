import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TaskStatusContext from '../src/contexts/TaskStatusContextBase';
import Interview from '../src/pages/Interview';
import { ResumeReferenceAnswers } from '../src/pages/Review';

const browser = new GlobalWindow({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator,
  localStorage: browser.localStorage, sessionStorage: browser.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
browser.HTMLElement.prototype.scrollIntoView = () => {};
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let response: Record<string, unknown>;
let status: number;
let calls: string[];
const startTask = () => {};

beforeEach(() => {
  calls = []; status = 200;
  localStorage.clear(); sessionStorage.clear();
  response = {
    session_id: 'qa', mode: 'resume', status: 'ongoing', can_continue: true,
    is_finished: false, questions: [], meta: {}, transcript: [
      { role: 'assistant', content: '请介绍项目经历。' },
      { role: 'user', content: '我完成了并发写入修复。' },
      { role: 'assistant', content: '如何验证事务和唯一约束？' },
    ],
  };
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = '';
});
afterAll(async () => {
  await browser.happyDOM.close(); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function mount(state: Record<string, unknown>) {
  const host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(
    <MemoryRouter initialEntries={[{ pathname: '/interview/qa', state }]}>
      <TaskStatusContext.Provider value={{ tasks: [], startTask, dismissTask() {}, creatingSessionMode: null, setCreatingSessionMode() {} }}>
        <Routes><Route path="/interview/:sessionId" element={<Interview />} /></Routes>
      </TaskStatusContext.Provider>
    </MemoryRouter>,
  ));
}

test('refresh with retained router state restores the latest saved conversation', async () => {
  await mount({ mode: 'resume', message: '旧开场' });
  expect(calls).toEqual(['/api/interview/session/qa/resume']);
  expect(document.body.textContent).toContain('我完成了并发写入修复。');
  expect(document.body.textContent).toContain('如何验证事务和唯一约束？');
  expect(document.body.textContent).not.toContain('旧开场');
  expect(document.querySelector('textarea')?.disabled).toBeFalse();
});

test('a reviewed session stays closed even when router state says it just started', async () => {
  response = { ...response, status: 'reviewed', can_continue: false, is_finished: true };
  await mount({ mode: 'resume', message: '旧开场' });
  expect(document.querySelector('textarea')?.disabled).toBeTrue();
  expect(document.body.textContent).toContain('查看复盘');
  expect(document.body.textContent).toContain('如何验证事务和唯一约束？');
});

test('a drill restores saved answers and opens the first unanswered question', async () => {
  response = {
    ...response, mode: 'topic_drill', questions: [
      { id: 1, question: '第一题' }, { id: 2, question: '第二题' },
    ], transcript: [{ role: 'assistant', content: '第一题' }, { role: 'user', content: '已保存的回答' }],
  };
  await mount({ mode: 'topic_drill', questions: [{ id: 1, question: '旧题目' }] });
  expect(document.body.textContent).toContain('第二题');
  expect(document.body.textContent).toContain('1/2 已答');
  expect(document.body.textContent).not.toContain('旧题目');
});

test('a missing session reports the server error instead of displaying stale router content', async () => {
  response = { detail: 'Session not found.' }; status = 404;
  await mount({ mode: 'resume', message: '旧开场' });
  expect(document.body.textContent).toContain('Session not found.');
  expect(document.querySelector('textarea')).toBeNull();
});

test('a stream error reads saved state without automatically posting the answer again', async () => {
  localStorage.setItem('techspar-session', JSON.stringify({ token: 'test-token', user: { id: 'account-a' } }));
  sessionStorage.setItem('interview-draft:account-a:qa', '我的新回答');
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/chat/stream')) {
      response = { ...response, transcript: [...response.transcript as object[], { role: 'user', content: '我的新回答' }] };
      return new Response('data: {"error":"网关断开"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  await mount({});
  expect(document.querySelector('textarea')?.value).toBe('我的新回答');
  await act(async () => {
    document.querySelector('textarea')!.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  expect(calls.filter(url => url.endsWith('/chat/stream'))).toHaveLength(1);
  expect(calls.some(url => url.endsWith('/chat'))).toBeFalse();
  expect(document.body.textContent?.match(/我的新回答/g)).toHaveLength(1);
  expect(document.body.textContent).toContain('重试上一条回答');
  expect(document.querySelector('textarea')?.disabled).toBeTrue();
});

test('a reopened pending turn picks up the saved reply without another model request', async () => {
  response = { ...response, transcript: [...response.transcript as object[], { role: 'user', content: '已提交的回答' }] };
  await mount({});
  expect(document.querySelector('textarea')?.disabled).toBeTrue();
  response = { ...response, transcript: [...response.transcript as object[], { role: 'assistant', content: '新保存的后续追问' }] };
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 2150)); });
  expect(document.body.textContent).toContain('新保存的后续追问');
  expect(document.querySelector('textarea')?.disabled).toBeFalse();
  expect(calls.every(url => url.endsWith('/resume'))).toBeTrue();
});

test('resume reference answers retain errors as retryable state and display the successful answer', async () => {
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    return attempts === 1
      ? new Response(JSON.stringify({ detail: '临时错误' }), { status: 502 })
      : new Response(JSON.stringify({ reference_answer: '## 回答框架\n结合真实职责说明验证方法。', cached: false }));
  }) as typeof fetch;
  const host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<ResumeReferenceAnswers sessionId="qa" questions={[{ id: 'resume-turn-1', question: '如何验证？' }]} transcript={[{ role: 'assistant', content: '如何验证？' }, { role: 'user', content: '我的验证步骤' }]} initialAnswers={{}} />));
  await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('重试生成参考答法');
  expect(document.body.textContent).toContain('临时错误');
  await act(async () => (document.querySelector('button') as HTMLButtonElement).click());
  expect(document.body.textContent).toContain('结合真实职责说明验证方法。');
  expect(document.body.textContent).not.toContain('临时错误');
  expect(attempts).toBe(2);
});

import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Knowledge from '../src/pages/Knowledge';

const browser = new GlobalWindow({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, sessionStorage: browser.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true, alert: () => {}, confirm: () => false })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let core: Record<string, string>;
let frequency: Record<string, string>;
let onRequest: ((path: string, init?: RequestInit) => Promise<Response> | undefined) | undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('techspar-session', JSON.stringify({ token: 'test-token', user: { id: 'account-a' } }));
  core = { python: 'Python 原内容', agent: 'Agent 原内容' };
  frequency = { python: 'Python 原题', agent: 'Agent 原题' };
  onRequest = undefined;
  globalThis.fetch = (async (url, init) => {
    const path = String(url);
    const deferred = onRequest?.(path, init);
    if (deferred) return deferred;
    if (path === '/api/topics') return json({ python: { name: 'Python' }, agent: { name: 'Agent' } });
    const topic = path.includes('/agent') ? 'agent' : 'python';
    if (path.includes('/high_freq')) {
      if (init?.method === 'PUT') frequency[topic] = JSON.parse(String(init.body)).content;
      return json({ content: frequency[topic] });
    }
    if (path.includes('/core')) {
      if (init?.method === 'PUT') { core[topic] = JSON.parse(String(init.body)).content; return json({ ok: true }); }
      return json([{ filename: 'notes.md', content: core[topic] }]);
    }
    throw new Error('Unexpected request: ' + path);
  }) as typeof fetch;
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
afterAll(async () => {
  globalThis.fetch = originalFetch; await browser.happyDOM.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
async function mount() {
  const host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Knowledge />));
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function edit(value: string) {
  const input = document.querySelector('textarea')!;
  expect(input).not.toBeNull();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new browser.Event('input', { bubbles: true }));
    input.dispatchEvent(new browser.KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
}
async function remount() { await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; await mount(); }

test('core knowledge drafts survive topic changes, remount and failed saves', async () => {
  await mount(); await click('编辑'); await edit('尚未保存的 Python 笔记');
  await click('Agent'); await click('Python');
  expect(document.querySelector('textarea')?.value).toBe('尚未保存的 Python 笔记');
  await remount(); expect(document.querySelector('textarea')?.value).toBe('尚未保存的 Python 笔记');
  onRequest = (_path, init) => init?.method === 'PUT' ? Promise.resolve(json({ detail: '暂时不可用' }, 502)) : undefined;
  await click('保存'); await remount();
  expect(document.querySelector('textarea')?.value).toBe('尚未保存的 Python 笔记');
  expect(core.python).toBe('Python 原内容');
});

test('high frequency drafts survive topic changes and are discarded only after a successful save', async () => {
  await mount(); await click('高频题库'); await click('编辑'); await edit('新的高频题草稿');
  await click('Agent'); await click('Python');
  expect(document.querySelector('textarea')?.value).toBe('新的高频题草稿');
  await click('保存'); await remount(); await click('高频题库');
  expect(document.querySelector('textarea')).toBeNull();
  expect(document.body.textContent).toContain('新的高频题草稿');
  expect(frequency.python).toBe('新的高频题草稿');
});

test('knowledge drafts are isolated between accounts and cancel restores saved content', async () => {
  await mount(); await click('编辑'); await edit('账号 A 的私有草稿');
  localStorage.setItem('techspar-session', JSON.stringify({ token: 'other-token', user: { id: 'account-b' } }));
  await remount(); expect(document.body.textContent).not.toContain('账号 A 的私有草稿');
  localStorage.setItem('techspar-session', JSON.stringify({ token: 'test-token', user: { id: 'account-a' } }));
  await remount(); expect(document.querySelector('textarea')?.value).toBe('账号 A 的私有草稿');
  await click('取消'); await remount(); expect(document.querySelector('textarea')).toBeNull();
  expect(document.body.textContent).toContain('Python 原内容');
});

test('old topic content is hidden while the next topic loads and load errors can be retried', async () => {
  await mount();
  onRequest = path => path.includes('/agent') ? Promise.resolve(json({ detail: '知识库暂时不可用' }, 503)) : undefined;
  await click('Agent'); expect(document.body.textContent).not.toContain('Python 原内容');
  expect(document.body.textContent).toContain('知识库暂时不可用');
  onRequest = undefined; await click('重新加载'); expect(document.body.textContent).toContain('Agent 原内容');
});

test('a late save from the previous topic cannot replace or close the current editor', async () => {
  let finish!: () => void;
  onRequest = (path, init) => path.includes('/python/') && init?.method === 'PUT' ? new Promise(resolve => { finish = () => resolve(json({ ok: true })); }) : undefined;
  await mount(); await click('编辑'); await edit('Python 提交中的内容'); await click('保存');
  await click('Agent'); await click('编辑'); await edit('Agent 尚未保存的草稿');
  await act(async () => finish());
  expect(document.querySelector('textarea')?.value).toBe('Agent 尚未保存的草稿');
  expect(document.body.textContent).not.toContain('Python 提交中的内容');
});

test('restoring a draft against changed server content shows a warning', async () => {
  await mount(); await click('编辑'); await edit('我的本机草稿');
  core.python = '另一窗口已更新的知识'; await remount();
  expect(document.querySelector('textarea')?.value).toBe('我的本机草稿');
  expect(document.body.textContent).toContain('已变化');
  await click('保存');
  expect(core.python).toBe('另一窗口已更新的知识');
  expect(document.querySelector('textarea')?.value).toBe('我的本机草稿');
  await click('取消');
  expect(document.body.textContent).toContain('另一窗口已更新的知识');
});


test('a late save cannot discard a newer draft after returning to the same topic', async () => {
  let finish!: () => void;
  onRequest = (path, init) => path.includes('/python/') && init?.method === 'PUT' ? new Promise(resolve => { finish = () => resolve(json({ ok: true })); }) : undefined;
  await mount(); await click('编辑'); await edit('第一份提交'); await click('保存');
  await click('Agent'); await click('Python'); await edit('后来继续写的新草稿');
  await act(async () => finish()); await remount();
  expect(document.querySelector('textarea')?.value).toBe('后来继续写的新草稿');
});

test('a slow previous-topic read cannot appear in the current topic', async () => {
  let finish!: () => void;
  await mount();
  onRequest = path => path.endsWith('/agent/core') ? new Promise(resolve => { finish = () => resolve(json([{ filename: 'notes.md', content: '迟到的 Agent 内容' }])); }) : undefined;
  await click('Agent'); expect(document.body.textContent).not.toContain('Python 原内容');
  await click('Python'); await act(async () => finish());
  expect(document.body.textContent).toContain('Python 原内容');
  expect(document.body.textContent).not.toContain('迟到的 Agent 内容');
});

test('topic list load failures are actionable instead of appearing as an empty library', async () => {
  onRequest = path => path === '/api/topics' ? Promise.resolve(json({ detail: '领域读取失败' }, 503)) : undefined;
  await mount(); expect(document.body.textContent).toContain('领域读取失败');
  onRequest = undefined; await click('重新加载');
  expect(document.body.textContent).toContain('Python 原内容');
});

test('draft storage failures retain the editor and explain that the draft is not backed up', async () => {
  await mount(); await click('编辑');
  const storage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('Storage full'); } } });
  try {
    await edit('仍在编辑器中的内容');
    expect(document.querySelector('textarea')?.value).toBe('仍在编辑器中的内容');
    expect(document.body.textContent).toContain('草稿暂存失败');
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }); }
});

test('browser drafts survive a new session storage and desktop drafts restore from main-process storage', async () => {
  await mount(); await click('编辑'); await edit('跨重启的草稿');
  sessionStorage.clear(); await remount();
  expect(document.querySelector('textarea')?.value).toBe('跨重启的草稿');
  await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.removeItem('knowledge-draft:account-a:python:core:notes.md');
  const key = 'knowledge-draft:account-a:python:core:notes.md';
  const saved: Record<string, { base: string; content: string }> = { [key]: { base: 'Python 原内容', content: '桌面主进程恢复的草稿' } };
  window.techsparDesktop = { getRuntimeInfo: async () => ({ appVersion: '', platform: '', arch: '', electronVersion: '', chromeVersion: '', nodeVersion: '' }), bootstrapSession: async () => { throw new Error('unused'); }, getKnowledgeDrafts: async () => saved, setKnowledgeDraft: async (draftKey, draft) => { if (draft) saved[draftKey] = draft; else delete saved[draftKey]; } };
  try {
    const { initializeKnowledgeDrafts } = await import('../src/lib/knowledgeDrafts');
    await initializeKnowledgeDrafts(); await mount();
    expect(document.querySelector('textarea')?.value).toBe('桌面主进程恢复的草稿');
    await edit('桌面草稿继续修改');
    expect(saved[key]?.content).toBe('桌面草稿继续修改');
    await click('保存'); expect(saved[key]).toBeUndefined();
    // A browser backup from a previous port must not resurrect a cleared desktop draft.
    localStorage.setItem(key, JSON.stringify({ base: 'Python 原内容', content: '过期备份' }));
    await initializeKnowledgeDrafts(); await remount();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.textContent).not.toContain('过期备份');
    window.techsparDesktop.getKnowledgeDrafts = async () => { throw new Error('Unreadable draft file'); };
    await act(async () => initializeKnowledgeDrafts());
    expect(document.body.textContent).toContain('本机草稿读取失败');
    window.techsparDesktop.getKnowledgeDrafts = async () => saved;
    await act(async () => initializeKnowledgeDrafts());
    expect(document.body.textContent).not.toContain('本机草稿读取失败');
  } finally { delete window.techsparDesktop; }
});

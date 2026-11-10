import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import AuthContext from '../src/contexts/AuthContextBase';
import Onboarding from '../src/pages/Onboarding';

const browser = new GlobalWindow({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator,
  localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let llmOk: boolean;
let embeddingOk: boolean;
let configured: boolean;
let embedding: Record<string, string>;
let savedHeaders: Record<string, string>;
const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  llmOk = true; embeddingOk = true; configured = false; embedding = {}; requests.length = 0;
  savedHeaders = {};
  globalThis.fetch = (async (url, options) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    requests.push({ url: String(url), body });
    if (String(url) === '/api/settings/test-llm') return json({ ok: llmOk, error: 'LLM unavailable' });
    if (String(url) === '/api/settings/test-embedding') return json({ ok: embeddingOk, error: 'Embedding unavailable' });
    if (String(url) === '/api/settings' && options?.method === 'PUT') return json({ ok: true });
    if (String(url) === '/api/settings') return json({
      llm: { api_base: 'https://gateway.test/v1', api_key: 'synthetic-test-key', model: 'test-model', compatibility: 'generic', temperature: 0.4, http_headers: savedHeaders },
      embedding, services: { tavily_api_key: 'synthetic-search-key' },
      training: { num_questions: 6, divergence: 2 }, system: { allow_registration: false },
    });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});

function Location() { const { pathname, search } = useLocation(); return <output>{pathname}{search}</output>; }
async function mount() {
  const host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  await act(async () => {
    root!.render(<MemoryRouter><AuthContext.Provider value={{
      user: { id: 'local-user' }, token: 'synthetic-token', loading: false, verificationError: null,
      retryVerification() {}, needsOnboarding: true, setNeedsOnboarding(value) { configured = !value; }, login() {}, logout() {},
    }}><Onboarding /><Location /></AuthContext.Provider></MemoryRouter>);
  });
}
function button(text: string) {
  const found = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
const saves = () => requests.filter(request => request.url === '/api/settings' && request.body);

test('a local-only first run saves local embedding without probing or downloading a model', async () => {
  await mount(); await click('下一步'); await click('使用本地向量，开始使用');
  expect(requests.filter(request => request.url.includes('test-embedding'))).toHaveLength(0);
  expect(saves()).toHaveLength(1);
  expect(saves()[0]!.body).toMatchObject({
    llm: { api_base: 'https://gateway.test/v1', api_key: 'synthetic-test-key', model: 'test-model' },
    embedding: { backend: 'local', local_model: 'Xenova/bge-m3', local_path: '' },
    services: { tavily_api_key: 'synthetic-search-key' }, training: { num_questions: 6, divergence: 2 },
  });
  expect(configured).toBeTrue(); expect(document.querySelector('output')?.textContent).toBe('/mock-interview?mode=live');
});

test('a failed text model test keeps the user in the first step without saving', async () => {
  llmOk = false; await mount(); await click('下一步');
  expect(document.body.textContent).toContain('LLM unavailable');
  expect(saves()).toHaveLength(0); expect(configured).toBeFalse();
});

test('remote embedding still requires a successful provider test before saving', async () => {
  embedding = { backend: 'api', api_base: 'https://embedding.test/v1', api_key: 'synthetic-embedding-key', api_model: 'test-embedding' };
  embeddingOk = false; await mount(); await click('下一步'); await click('完成,开始使用');
  expect(document.body.textContent).toContain('Embedding unavailable');
  expect(saves()).toHaveLength(0); expect(configured).toBeFalse();
  embeddingOk = true; await click('完成,开始使用');
  expect(saves()[0]!.body?.embedding).toMatchObject(embedding);
  expect(configured).toBeTrue();
});

test('onboarding tests and saves Responses with xhigh and gateway headers', async () => {
  savedHeaders = { 'x-openai-actor-authorization': 'local-image-extension' };
  await mount();
  await act(async () => {
    const compatibility = document.querySelector<HTMLSelectElement>('select:not(#llm-reasoning-effort)')!;
    compatibility.value = 'responses'; compatibility.dispatchEvent(new browser.Event('change', { bubbles: true }));
  });
  await act(async () => {
    const effort = document.querySelector<HTMLSelectElement>('#llm-reasoning-effort')!;
    effort.value = 'xhigh'; effort.dispatchEvent(new browser.Event('change', { bubbles: true }));
  });
  await click('下一步'); await click('使用本地向量，开始使用');
  const expected = { compatibility: 'responses', reasoning_effort: 'xhigh', http_headers: { 'x-openai-actor-authorization': 'local-image-extension' } };
  expect(requests.find(request => request.url.endsWith('test-llm'))?.body).toMatchObject(expected);
  expect(saves()[0]?.body?.llm).toMatchObject(expected);
});

import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppearancePicker } from '../src/components/AppearancePicker';
import { APPEARANCE_STORAGE_KEY, getAppearanceState, initializeAppearance, setAppearanceTheme } from '../src/lib/appearance';

const browser = new GlobalWindow({ url: 'http://localhost' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
let root: Root | undefined;
beforeEach(async () => { localStorage.clear(); delete window.techsparDesktop; await initializeAppearance(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });

test('migrates old dark preference and restores an explicit theme on reopen', async () => {
  localStorage.setItem('theme', 'dark');
  await initializeAppearance();
  expect(document.documentElement.dataset.appearance).toBe('teal');
  expect(document.documentElement.classList.contains('dark')).toBeTrue();
  await setAppearanceTheme('wine');
  await initializeAppearance();
  expect(getAppearanceState().theme).toBe('wine');
  expect(document.documentElement.classList.contains('dark')).toBeFalse();
  expect(localStorage.getItem('theme')).toBe('light');
});

test('desktop preference restores after the new origin has empty browser storage', async () => {
  window.techsparDesktop = { getAppearanceTheme: async () => 'wine' } as Window['techsparDesktop'];
  await initializeAppearance();
  expect(getAppearanceState().theme).toBe('wine');
  expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('wine');
});

test('first desktop startup persists the default or migrated legacy selection', async () => {
  const writes: string[] = [];
  localStorage.setItem('theme', 'dark');
  window.techsparDesktop = { getAppearanceTheme: async () => undefined, setAppearanceTheme: async theme => { writes.push(theme); } } as Window['techsparDesktop'];
  await initializeAppearance();
  expect(writes).toEqual(['teal']);
});

test('a delayed startup read cannot override a newer user choice', async () => {
  let finish!: (theme: 'navy') => void;
  window.techsparDesktop = { getAppearanceTheme: () => new Promise(resolve => { finish = resolve; }), setAppearanceTheme: async () => {} } as Window['techsparDesktop'];
  const initializing = initializeAppearance();
  await setAppearanceTheme('wine');
  finish('navy'); await initializing;
  expect(getAppearanceState().theme).toBe('wine');
});

test('failed desktop persistence reports a recoverable error and preserves the live theme', async () => {
  let fail = true;
  window.techsparDesktop = { setAppearanceTheme: async () => { if (fail) throw new Error('Disk unavailable'); } } as Window['techsparDesktop'];
  await setAppearanceTheme('teal');
  expect(getAppearanceState().theme).toBe('teal');
  expect(getAppearanceState().error).toContain('未能保存');
  fail = false;
  await setAppearanceTheme('wine');
  expect(getAppearanceState().error).toBe('');
});

test('rapid changes save in order and an old failure cannot overwrite the latest choice', async () => {
  const calls: string[] = [];
  let rejectFirst!: (reason: Error) => void;
  window.techsparDesktop = { setAppearanceTheme: theme => { calls.push(theme); return calls.length === 1 ? new Promise<void>((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve(); } } as Window['techsparDesktop'];
  const first = setAppearanceTheme('teal');
  await Promise.resolve();
  const last = setAppearanceTheme('wine');
  rejectFirst(new Error('First write failed'));
  await Promise.all([first, last]);
  expect(calls).toEqual(['teal', 'wine']);
  expect(getAppearanceState()).toEqual({ theme: 'wine', error: '' });
});

test('both pickers update together without clearing a mounted answer draft', async () => {
  const host = document.createElement('main'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<><AppearancePicker /><AppearancePicker compact /><textarea defaultValue="保留我的作答草稿" /></>));
  await act(async () => { document.querySelector<HTMLInputElement>('input[value="teal"]')!.click(); });
  expect(document.querySelectorAll('input[value="teal"]:checked')).toHaveLength(2);
  expect(document.querySelector('textarea')!.value).toBe('保留我的作答草稿');
});

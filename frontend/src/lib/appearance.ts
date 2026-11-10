export const APPEARANCE_THEMES = [
  { id: 'navy', name: '雾白 · 墨蓝', description: '明亮清晰，适合日常练习', background: '#f3f5f8', surface: '#ffffff', accent: '#294e85', ink: '#202d43' },
  { id: 'teal', name: '深灰 · 青绿', description: '柔和暗色，专注这一轮面试', background: '#131a20', surface: '#1a232b', accent: '#75d4bd', ink: '#e1e9ed' },
  { id: 'wine', name: '米白 · 酒红', description: '温暖纸感，慢慢整理与复盘', background: '#f7f4ed', surface: '#fcfaf5', accent: '#8b424d', ink: '#3f3531' },
] as const;
export type AppearanceTheme = typeof APPEARANCE_THEMES[number]['id'];
export const APPEARANCE_STORAGE_KEY = 'interview-room-theme';
type AppearanceState = { theme: AppearanceTheme; error: string };
let state: AppearanceState = { theme: 'navy', error: '' };
const listeners = new Set<() => void>();
let saveVersion = 0;
let writeQueue = Promise.resolve();

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return APPEARANCE_THEMES.some(theme => theme.id === value);
}

function readBrowserTheme(): AppearanceTheme {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (isAppearanceTheme(saved)) return saved;
    return localStorage.getItem('theme') === 'dark' ? 'teal' : 'navy';
  } catch { return 'navy'; }
}

function apply(theme: AppearanceTheme) {
  document.documentElement.dataset.appearance = theme;
  document.documentElement.classList.toggle('dark', theme === 'teal');
  document.documentElement.style.colorScheme = theme === 'teal' ? 'dark' : 'light';
}

function remember(theme: AppearanceTheme): boolean {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, theme);
    localStorage.setItem('theme', theme === 'teal' ? 'dark' : 'light');
    return true;
  } catch { return false; }
}

function publish(next: AppearanceState) {
  state = next;
  apply(next.theme);
  listeners.forEach(listener => listener());
}

export const getAppearanceState = () => state;
export function subscribeAppearance(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export async function initializeAppearance(): Promise<void> {
  const version = ++saveVersion;
  publish({ theme: readBrowserTheme(), error: '' });
  try {
    const theme = await window.techsparDesktop?.getAppearanceTheme?.();
    if (version === saveVersion && isAppearanceTheme(theme)) {
      remember(theme);
      publish({ theme, error: '' });
    } else if (version === saveVersion && window.techsparDesktop?.setAppearanceTheme) {
      await setAppearanceTheme(state.theme);
    }
  } catch {
    if (version === saveVersion) publish({ ...state, error: '无法读取已保存的配色，暂用当前主题。' });
  }
}

export async function setAppearanceTheme(theme: AppearanceTheme): Promise<void> {
  if (!isAppearanceTheme(theme)) return;
  const version = ++saveVersion;
  const browserSaved = remember(theme);
  publish({ theme, error: '' });
  const persist = window.techsparDesktop?.setAppearanceTheme;
  if (!persist) {
    if (!browserSaved) publish({ theme, error: '当前配色已生效；浏览器未允许保存，重新打开可能重置。' });
    return;
  }
  const operation = writeQueue.then(() => persist(theme));
  writeQueue = operation.catch(() => undefined);
  try { await operation; }
  catch {
    if (version === saveVersion) publish({ theme, error: '配色已生效，但未能保存到桌面。请再选择一次重试。' });
  }
}

export function syncBrowserAppearance(event: StorageEvent) {
  if (event.key === APPEARANCE_STORAGE_KEY && isAppearanceTheme(event.newValue)) {
    ++saveVersion;
    publish({ theme: event.newValue, error: '' });
  }
}

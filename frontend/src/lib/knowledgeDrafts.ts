import { readSession } from './authSession';

type DraftKind = 'core' | 'high_freq';
export interface KnowledgeDraft { base: string; content: string }
const desktopDrafts = new Map<string, KnowledgeDraft>();
let desktopLoaded = false;
let desktopLoadFailed = false;
const pending = new Map<string, number>();
const failures = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function subscribeDraftStorage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function draftStorageStatus(): string {
  const account = readSession()?.user.id;
  const prefix = account ? `knowledge-draft:${encodeURIComponent(account)}:` : '';
  if (account && desktopLoadFailed) return '本机草稿读取失败，请重启重试；原草稿文件保留，当前可继续查看已保存知识。';
  if (prefix && [...failures].some(key => key.startsWith(prefix))) return '草稿暂存失败，请保持页面打开并保存，或复制内容备份。';
  if (prefix && [...pending.keys()].some(key => key.startsWith(prefix))) return '正在保存本机草稿…';
  return '';
}
export async function initializeKnowledgeDrafts(): Promise<void> {
  try {
    const saved = await window.techsparDesktop?.getKnowledgeDrafts?.();
    if (saved) {
      desktopDrafts.clear();
      for (const [key, value] of Object.entries(saved)) if (valid(value)) desktopDrafts.set(key, value);
      desktopLoaded = true; desktopLoadFailed = false;
    }
  } catch { desktopLoadFailed = true; }
  emit();
}
function valid(value: unknown): value is KnowledgeDraft {
  return Boolean(value && typeof value === 'object' && typeof (value as KnowledgeDraft).base === 'string' && typeof (value as KnowledgeDraft).content === 'string');
}
function draftKey(topic: string, kind: DraftKind, filename: string): string | null {
  const account = readSession()?.user.id;
  return account ? ['knowledge-draft', account, topic, kind, filename].map(encodeURIComponent).join(':') : null;
}
function read(key: string): KnowledgeDraft | null {
  try {
    if (window.techsparDesktop?.setKnowledgeDraft && (desktopLoaded || desktopDrafts.has(key))) return desktopDrafts.get(key) || null;
    const draft: unknown = JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || 'null');
    return valid(draft) ? draft : null;
  } catch { return null; }
}
function write(key: string, draft: KnowledgeDraft | null): boolean {
  const persist = window.techsparDesktop?.setKnowledgeDraft;
  if (persist) {
    if (draft) desktopDrafts.set(key, draft); else desktopDrafts.delete(key);
    pending.set(key, (pending.get(key) || 0) + 1); emit();
    void persist(key, draft).then(() => { failures.delete(key); }).catch(() => { failures.add(key); }).finally(() => {
      const count = (pending.get(key) || 1) - 1;
      if (count) pending.set(key, count); else pending.delete(key);
      emit();
    });
    try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else { localStorage.removeItem(key); sessionStorage.removeItem(key); } } catch { /* Main process owns durable desktop storage. */ }
    return true;
  }
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}
export function readKnowledgeDraft(topic: string, kind: DraftKind, filename = ''): KnowledgeDraft | null {
  const key = draftKey(topic, kind, filename); return key ? read(key) : null;
}
export function saveKnowledgeDraft(topic: string, kind: DraftKind, filename: string, base: string, content: string): boolean {
  const key = draftKey(topic, kind, filename); return key ? write(key, content === base ? null : { base, content }) : false;
}
export function clearKnowledgeDraft(topic: string, kind: DraftKind, filename = ''): void {
  const key = draftKey(topic, kind, filename); if (key) write(key, null);
}
export function captureSavedDraftCleanup(topic: string, kind: DraftKind, filename: string, content: string): () => void {
  const key = draftKey(topic, kind, filename);
  return () => { if (key && read(key)?.content === content) write(key, null); };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultSettings, InputError } from './model.ts';
import type { Job, Material, Session, Settings, Topic, ModelProfile } from './model.ts';

type Collection = 'materials' | 'sessions' | 'jobs' | 'topics' | 'meta' | 'profiles';
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (version > 1) { this.db.close(); throw new InputError('数据库来自更新版本，请升级应用；原文件未修改'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL, PRIMARY KEY(collection,id));
      CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);`);
    this.db.exec('PRAGMA user_version=1');
  }
  get<T>(collection: Collection, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM records WHERE collection=? AND id=?').get(collection, id);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }
  require<T>(collection: Collection, id: string): T {
    const value = this.get<T>(collection, id);
    if (!value) throw new InputError('记录不存在', 404);
    return value;
  }
  list<T>(collection: Collection): T[] {
    return this.db.prepare('SELECT value FROM records WHERE collection=? ORDER BY rowid DESC').all(collection)
      .map(row => JSON.parse(String(row.value)) as T);
  }
  put<T extends { id: string }>(collection: Collection, value: T): void {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value')
      .run(collection, value.id, JSON.stringify(value));
  }
  delete(collection: Collection, id: string): void {
    this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id);
  }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settings(): Settings {
    const row = this.db.prepare('SELECT value FROM config WHERE id=1').get();
    const base: Settings = row ? { ...defaultSettings, ...JSON.parse(String(row.value)) } : structuredClone(defaultSettings);
    base.theme = base.theme === 'forest' ? 'forest' : 'ink';
    const selected = this.get<{ profileId: string }>('meta', 'model-selection');
    const profile = selected ? this.get<ModelProfile>('profiles', selected.profileId) : undefined;
    return profile ? { ...base, ...profile.connection, theme: base.theme } : base;
  }
  setSettings(value: Settings): void {
    this.db.prepare('INSERT INTO config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(value));
    const selected = this.get<{ profileId: string }>('meta', 'model-selection');
    const profile = selected ? this.get<ModelProfile>('profiles', selected.profileId) : undefined;
    if (profile) {
      const { theme: _theme, ...connection } = value;
      if (JSON.stringify(connection) !== JSON.stringify(profile.connection))
        this.put('profiles', { ...profile, connection, revision: profile.revision + 1, updatedAt: new Date().toISOString() });
    }
  }
  setTheme(theme: Settings['theme']): void {
    // Theme changes must never write an older browser copy of a model connection.
    const value = { ...this.settings(), theme };
    this.db.prepare('INSERT INTO config VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(value));
  }
  saveMaterial(value: Material, expectedRevision?: number): void {
    this.transaction(() => {
      const current = this.get<Material>('materials', value.id);
      if ((current?.revision ?? 0) !== (expectedRevision ?? 0)) throw new InputError('资料已更新，请刷新后重试；当前编辑内容尚未覆盖原版本', 409);
      this.put('materials', value);
    });
  }
  saveSession(session: Session): void {
    session.revision += 1; session.updatedAt = new Date().toISOString(); this.put('sessions', session);
  }
  running(sessionId: string): Job | undefined {
    return this.list<Job>('jobs').find(job => job.sessionId === sessionId && job.status === 'running');
  }
  interrupt(): void {
    for (const job of this.list<Job>('jobs')) if (job.status === 'running')
      this.put('jobs', { ...job, status: 'interrupted', error: '上次进程已退出。原回答和已保存片段保留；可手动重新生成。', updatedAt: new Date().toISOString() });
  }
  export(): { format: string; version: number; materials: Material[]; sessions: Session[]; topics: Topic[] } {
    return { format: 'interview-room-backup', version: 2, materials: this.list<Material>('materials'), sessions: this.list<Session>('sessions'), topics: this.list<Topic>('topics') };
  }
  close(): void { this.db.close(); }
}

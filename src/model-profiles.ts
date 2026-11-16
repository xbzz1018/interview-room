import { randomUUID } from 'node:crypto';
import { defaultSettings, InputError, object, settingsFrom, text } from './model.ts';
import type { ModelProfile, PublicModelProfile } from './model.ts';
import { Store } from './store.ts';

export class ModelProfiles {
  store: Store;
  constructor(store: Store) { this.store = store; }
  initialize(): void {
    if (this.store.get('meta', 'model-selection')) return;
    this.store.transaction(() => {
      const { theme: _theme, ...connection } = this.store.settings(), now = new Date().toISOString();
      this.store.put<ModelProfile>('profiles', { id: 'profile-default', name: '原有模型配置', provider: 'custom', connection, revision: 1, createdAt: now, updatedAt: now });
      this.store.put('meta', { id: 'model-selection', profileId: 'profile-default' });
    });
  }
  activeId(): string { return this.store.require<{ profileId: string }>('meta', 'model-selection').profileId; }
  public(profile: ModelProfile): PublicModelProfile {
    const { apiKey, ...connection } = profile.connection;
    return { ...profile, connection: { ...connection, hasApiKey: Boolean(apiKey) } };
  }
  list(): { activeId: string; profiles: PublicModelProfile[] } { return { activeId: this.activeId(), profiles: this.store.list<ModelProfile>('profiles').map(item => this.public(item)) }; }
  save(input: unknown, id?: string): PublicModelProfile {
    const body = object(input), current = id ? this.store.require<ModelProfile>('profiles', id) : undefined;
    if (current && body.revision !== current.revision) throw new InputError('模型配置已更新，当前编辑内容保留；请重新选择后再保存', 409);
    const name = text(body.name, '配置名称', 80).trim();
    if (this.store.list<ModelProfile>('profiles').some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new InputError('已有同名模型配置', 409);
    const settings = settingsFrom({ ...object(body.connection), theme: this.store.settings().theme }, current ? { ...current.connection, theme: this.store.settings().theme } : { ...defaultSettings, baseUrl: '', model: '', apiKey: '', headers: {} });
    const { theme: _theme, ...connection } = settings, now = new Date().toISOString();
    const profile: ModelProfile = { id: id ?? randomUUID(), name, provider: text(body.provider ?? 'custom', '服务商', 80), connection, revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now };
    this.store.put('profiles', profile); return this.public(profile);
  }
  activate(id: string): void {
    this.store.require<ModelProfile>('profiles', id);
    this.store.put('meta', { id: 'model-selection', profileId: id });
  }
  remove(id: string): void {
    this.store.require('profiles', id);
    if (id === this.activeId()) throw new InputError('请先启用其他模型，再删除当前配置', 409);
    this.store.delete('profiles', id);
  }
}

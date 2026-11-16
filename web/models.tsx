import React, { useEffect, useState } from 'react';
import type { PublicModelProfile, Settings } from '../src/model.ts';
import { api } from './api.ts';

type PublicSettings = Omit<Settings, 'apiKey'> & { hasApiKey: boolean };
type Act = <T>(action: () => Promise<T>, message?: string) => Promise<T | undefined>;
type Profiles = { activeId: string; profiles: PublicModelProfile[] };
const presets = [
  { id: 'custom', label: '自定义 / 兼容网关', url: '', protocol: 'responses', tokens: 'max_completion_tokens', effort: '', hint: '填写网关实际提供的模型 ID；同一家网关可以保存多份模型配置。' },
  { id: 'openai', label: 'OpenAI / GPT', url: 'https://api.openai.com/v1', protocol: 'responses', tokens: 'max_completion_tokens', effort: '', hint: '选择 Responses 或兼容的 Chat 协议，推理参数按所选模型填写。' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', protocol: 'chat', tokens: 'max_tokens', effort: '', hint: '使用 Chat 兼容接口；模型 ID 按服务商控制台填写。' },
  { id: 'xai', label: 'xAI / Grok', url: 'https://api.x.ai/v1', protocol: 'chat', tokens: 'max_tokens', effort: '', hint: '使用 Grok 模型的 Chat 兼容接口；不支持的推理参数保持默认。' },
  { id: 'anthropic', label: 'Anthropic / Claude', url: 'https://api.anthropic.com/v1', protocol: 'anthropic', tokens: 'max_tokens', effort: '', hint: '直连采用 Anthropic Messages。若通过兼容网关接 Claude，请改用网关提供的协议和地址。' },
  { id: 'qwen', label: '阿里云 / Qwen', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'chat', tokens: 'max_tokens', effort: '', hint: '这里提供兼容接口模板，区域、地址和模型以自己的控制台为准。' },
  { id: 'glm', label: '智谱 / GLM', url: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'chat', tokens: 'max_tokens', effort: '', hint: '使用 Chat 兼容模板，选择当前账号可用的模型。' },
  { id: 'kimi', label: '月之暗面 / Kimi', url: 'https://api.moonshot.cn/v1', protocol: 'chat', tokens: 'max_tokens', effort: '', hint: '使用 Chat 兼容模板；模型能力、图片输入和推理参数以接口支持为准。' },
] as const;
type Draft = { name: string; provider: string; baseUrl: string; protocol: Settings['protocol']; model: string; effort: string; apiKey: string; headersText: string; tokenParameter: NonNullable<Settings['tokenParameter']>; maxOutputTokens: number; timeoutSeconds: number; revision?: number; hasApiKey: boolean };
function draftFrom(profile?: PublicModelProfile, fallback?: PublicSettings): Draft {
  const value = profile?.connection ?? fallback;
  return { name: profile?.name ?? '', provider: profile?.provider ?? 'custom', baseUrl: value?.baseUrl ?? '', protocol: value?.protocol ?? 'responses', model: value?.model ?? '', effort: value?.effort ?? '', apiKey: '',
    headersText: JSON.stringify(value?.headers ?? {}, null, 2), tokenParameter: value?.tokenParameter ?? 'max_completion_tokens', maxOutputTokens: value?.maxOutputTokens ?? 4096, timeoutSeconds: value?.timeoutSeconds ?? 300,
    revision: profile?.revision, hasApiKey: value?.hasApiKey ?? false };
}

export function ModelSettings({ settings, busy, act }: { settings: PublicSettings; busy: boolean; act: Act }) {
  const [data, setData] = useState<Profiles>({ activeId: '', profiles: [] }), [selected, setSelected] = useState('');
  const [value, setValue] = useState<Draft>(() => draftFrom(undefined, settings)), [clearKey, setClearKey] = useState(false), [error, setError] = useState(''), [test, setTest] = useState(''), [loading, setLoading] = useState(true);
  const current = data.profiles.find(item => item.id === selected), active = data.profiles.find(item => item.id === data.activeId);
  const update = (patch: Partial<Draft>) => setValue(previous => ({ ...previous, ...patch }));
  async function reload(id?: string) {
    try {
      const latest = await api<Profiles>('/profiles'); setData(latest);
      const target = id ?? latest.activeId; setSelected(target); setValue(draftFrom(latest.profiles.find(item => item.id === target), settings)); setClearKey(false);
    } catch (error) { setError(`配置列表刷新失败，编辑内容保留：${(error as Error).message}`); }
  }
  useEffect(() => { let live = true; void api<Profiles>('/profiles').then(latest => {
    if (!live) return; setData(latest); setSelected(latest.activeId); setValue(draftFrom(latest.profiles.find(item => item.id === latest.activeId), settings));
  }).catch(error => { if (live) setError(error.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  function select(id: string) { setSelected(id); setValue(draftFrom(data.profiles.find(item => item.id === id))); setClearKey(false); setError(''); setTest(''); }
  function preset(id: string) {
    const item = presets.find(item => item.id === id); if (!item) return;
    if (current && !confirm('应用服务商模板会重置编辑区的接口地址、协议和参数；旧 Key 会从本次表单清除。只有点击保存才更新配置。')) return;
    update({ provider: item.id, name: value.name || item.label, baseUrl: item.url, protocol: item.protocol, tokenParameter: item.tokens, effort: item.effort, model: '', apiKey: '', headersText: '{}', hasApiKey: false }); setClearKey(true); setTest('');
  }
  const efforts = value.protocol === 'anthropic' ? ['', 'low', 'medium', 'high', 'xhigh', 'max'] : ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  return <div className="models-layout">
    <section className="panel profile-manager"><div className="section-head"><div><h2>我的模型配置</h2><p>每份配置单独保存地址、Key、模型和参数；新任务使用当前启用项。</p></div><div className="button-row"><button disabled={busy || loading} onClick={() => void reload(selected || undefined)}>重新读取</button><button disabled={busy || loading} onClick={() => select('')}>新增模型配置</button></div></div>
      <p className="model-active">当前启用：<strong>{active?.name ?? (loading ? '正在读取' : '尚未启用配置')}</strong> · {settings.model || '模型待配置'}</p>
      <div className="profile-list">{data.profiles.map(item => <button key={item.id} className={selected === item.id ? 'profile-choice selected-domain' : 'profile-choice'} aria-pressed={selected === item.id} onClick={() => select(item.id)}><strong>{item.name}</strong><span>{item.connection.model}</span><small>{item.id === data.activeId ? '已启用' : '已保存'} · {item.connection.protocol} · {item.connection.hasApiKey ? 'Key 已保存' : '未填 Key'}</small></button>)}</div>
      <p className="muted">切换只影响后续请求，正在进行的任务保留启动时的模型。保存配置后，可以单独测试再启用。</p>
    </section>
    <div className="profile-editor"><section className="panel settings-panel"><div className="section-head"><h2>模型连接</h2><span className="tag">{selected ? '编辑已保存配置' : '新建配置'}</span></div><div className="model-form-fields">
      <div className="two-fields"><label>配置名称<input value={value.name} maxLength={80} placeholder="例如：日常训练、深度复盘" onChange={event => update({ name: event.target.value })} /></label><label>服务商模板<select aria-label="服务商模板" value={value.provider} onChange={event => preset(event.target.value)}>{presets.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label></div>
      <p className="basis-note">{presets.find(item => item.id === value.provider)?.hint}模板只帮助填写，不会自动验证账号权限或代替连接测试。</p>
      <div className="two-fields"><label>API 基础地址<input value={value.baseUrl} placeholder="https://api.example.com/v1" onChange={event => update({ baseUrl: event.target.value })} /></label><label>请求协议<select aria-label="请求协议" value={value.protocol} onChange={event => update({ protocol: event.target.value as Settings['protocol'], effort: '', tokenParameter: event.target.value === 'anthropic' ? 'max_tokens' : value.tokenParameter })}><option value="responses">Responses</option><option value="chat">Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></label><label>模型 ID<input value={value.model} placeholder="填写服务商支持的模型 ID" maxLength={200} onChange={event => update({ model: event.target.value })} /></label><label>推理强度<select aria-label="推理强度" value={value.effort} onChange={event => update({ effort: event.target.value })}>{efforts.map(item => <option key={item} value={item}>{item || '接口默认（不发送参数）'}</option>)}</select></label></div>
      <label>API Key<input type="password" autoComplete="off" value={value.apiKey} placeholder={value.hasApiKey ? '已保存，留空保持不变' : '只在本机填写'} onChange={event => { update({ apiKey: event.target.value }); setClearKey(false); }} /></label>
      <details className="model-advanced"><summary>高级参数与认证</summary><label className="check-label"><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); update({ apiKey: '' }); }} />清除这份配置已保存的 API Key</label>
      <div className="two-fields"><label>单次输出 Token 上限<input type="number" min={512} max={32768} value={value.maxOutputTokens} onChange={event => update({ maxOutputTokens: Number(event.target.value) })} /></label><label>请求超时（秒）<input type="number" min={10} max={900} value={value.timeoutSeconds} onChange={event => update({ timeoutSeconds: Number(event.target.value) })} /></label></div>
      {value.protocol === 'chat' && <label>Chat 输出上限参数<select aria-label="Chat 输出上限参数" value={value.tokenParameter} onChange={event => update({ tokenParameter: event.target.value as Draft['tokenParameter'] })}><option value="max_tokens">max_tokens（常见兼容接口）</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>}
      <details><summary>自定义请求头</summary><label>JSON 对象<textarea className="code-input" value={value.headersText} onChange={event => update({ headersText: event.target.value })} /></label><p className="muted">认证令牌填写在 Key 中。Claude 直连自动使用 x-api-key，不需要手动添加。</p></details>
      </details><p className="muted">先保存再测试或启用。测试只发一次短请求，不发送个人资料，正常计入接口用量。</p>{error && <p role="alert" className="field-error">{error}</p>}</div>
      <div className="panel-footer"><div className="profile-actions">{current && <><button disabled={busy} onClick={async () => {
        setTest(''); const result = await act(() => api<{ model: string; effort: string; elapsedMs: number }>(`/profiles/${selected}/test`, 'POST', {})); if (result) setTest(`连接成功：${result.model} · ${(result.elapsedMs / 1000).toFixed(1)} 秒`);
      }}>测试这份模型配置</button><button disabled={busy || selected === data.activeId} onClick={async () => { const result = await act(() => api(`/profiles/${selected}/activate`, 'POST', {}), '已切换后续任务使用的模型'); if (result) await reload(selected); }}>启用这份模型</button><button className="subtle" disabled={busy || selected === data.activeId} onClick={async () => { if (confirm(`删除配置“${current.name}”？该配置的 Key 也会从本机删除。`)) { const result = await act(() => api(`/profiles/${selected}`, 'DELETE'), '模型配置已删除'); if (result) await reload(); } }}>删除配置</button></>}{test && <p role="status" className="muted">{test}</p>}</div><button className="primary" disabled={busy || loading || !value.name.trim() || !value.baseUrl.trim() || !value.model.trim()} onClick={async () => {
        setError(''); setTest('');
        let headers: unknown; try { headers = JSON.parse(value.headersText); } catch { setError('自定义请求头需要是 JSON 对象'); return; }
        const connection = { baseUrl: value.baseUrl, protocol: value.protocol, model: value.model, effort: value.effort, headers, maxOutputTokens: value.maxOutputTokens, timeoutSeconds: value.timeoutSeconds, tokenParameter: value.tokenParameter,
          apiKey: clearKey ? '' : value.apiKey || undefined };
        const result = await act(() => api<PublicModelProfile>(`/profiles${selected ? `/${selected}` : ''}`, selected ? 'PUT' : 'POST', { name: value.name, provider: value.provider, revision: value.revision, connection }), '模型配置已保存');
        if (result) await reload(result.id);
      }}>保存模型设置</button></div>
    </section>
    </div></div>;
}

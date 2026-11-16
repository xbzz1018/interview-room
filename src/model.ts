export type MaterialKind = 'resume' | 'project' | 'jd' | 'notes';
export type KnowledgeSection = 'core' | 'questions';
export type Topic = { id: string; name: string; description: string; revision: number; createdAt: string; updatedAt: string };
export type Material = {
  id: string; title: string; kind: MaterialKind; text: string; revision: number;
  createdAt: string; updatedAt: string;
  topicId?: string; knowledgeSection?: KnowledgeSection;
};
export type PracticeAttempt = { id: string; text: string; comparison?: string; createdAt: string };
export type Turn = { id: string; question: string; answer?: string; reference?: string; attempts: PracticeAttempt[] };
export type Session = {
  id: string; title: string; role: string; mode: 'strict' | 'coach';
  status: 'active' | 'completed'; materials: Material[]; turns: Turn[];
  revision: number; createdAt: string; updatedAt: string; review?: string; imported?: boolean;
  focus?: string; preparation?: string;
  trainingKind?: 'interview' | 'topic'; topicId?: string; topicName?: string;
};
export type Settings = {
  baseUrl: string; protocol: 'responses' | 'chat' | 'anthropic'; model: string; effort: string;
  apiKey: string; headers: Record<string, string>; maxOutputTokens: number; timeoutSeconds: number;
  theme: 'ink' | 'forest';
  tokenParameter?: 'max_tokens' | 'max_completion_tokens';
};
export type ModelProfile = { id: string; name: string; provider: string; connection: Omit<Settings, 'theme'>; revision: number; createdAt: string; updatedAt: string };
export type PublicModelProfile = Omit<ModelProfile, 'connection'> & { connection: Omit<ModelProfile['connection'], 'apiKey'> & { hasApiKey: boolean } };
export const defaultSettings: Settings = {
  baseUrl: '', protocol: 'responses',
  model: '', effort: '', apiKey: '', headers: {},
  maxOutputTokens: 4096, timeoutSeconds: 300, theme: 'ink',
};
export type JobInput = { kind: 'prepare' | 'next' | 'reference' | 'review' | 'compare' | 'knowledge'; turnId?: string; answer?: string; section?: KnowledgeSection };
export type Job = {
  id: string; sessionId: string; requestId: string; fingerprint: string; input: JobInput;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
  draft: string; error?: string; attempt: number; createdAt: string; updatedAt: string;
  model: string; effort: string; firstTokenMs?: number; elapsedMs?: number;
  materialId?: string;
  profileId?: string; profileName?: string;
};
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function text(value: unknown, label: string, max = 60000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    throw new InputError(`${label}需要填写，且不能超过 ${max} 字符`);
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('需要 JSON 对象');
  return value as Record<string, unknown>;
}
export function settingsFrom(value: unknown, previous: Settings): Settings {
  const body = object(value);
  const baseUrl = text(body.baseUrl, 'API 地址', 2000).trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new InputError('API 地址格式无效，请填写完整 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new InputError('API 地址需要是无账号、查询参数或片段的 HTTP(S) 地址');
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new InputError('非本机 API 请使用 HTTPS');
  if (!['responses', 'chat', 'anthropic'].includes(String(body.protocol))) throw new InputError('不支持的 API 协议');
  if (!(body.protocol === 'anthropic' ? ['', 'low', 'medium', 'high', 'xhigh', 'max'] : ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']).includes(String(body.effort))) throw new InputError('当前协议不支持该推理强度，请选择接口支持的参数');
  const tokenParameter = body.tokenParameter ?? previous.tokenParameter ?? 'max_completion_tokens';
  if (!['max_tokens', 'max_completion_tokens'].includes(String(tokenParameter))) throw new InputError('Chat 输出上限参数无效');
  if (!['ink', 'forest'].includes(String(body.theme))) throw new InputError('不支持的主题');
  const headers = object(body.headers);
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[\w-]+$/.test(key) || /^(host|content-length|connection|cookie|authorization|x-api-key|content-type|accept)$/i.test(key)
      || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 4000)
      throw new InputError('自定义请求头无效；认证请填 API Key');
  }
  const maxOutputTokens = Number(body.maxOutputTokens), timeoutSeconds = Number(body.timeoutSeconds);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 512 || maxOutputTokens > 32768
    || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 900) throw new InputError('输出上限或超时时间不在允许范围');
  return { baseUrl, protocol: body.protocol as Settings['protocol'], model: text(body.model, '模型', 200).trim(),
    effort: String(body.effort), headers: headers as Record<string, string>, maxOutputTokens, timeoutSeconds,
    theme: body.theme as Settings['theme'], tokenParameter: tokenParameter as Settings['tokenParameter'],
    apiKey: body.apiKey === undefined ? previous.apiKey : text(body.apiKey, 'API Key', 8000, true) };
}

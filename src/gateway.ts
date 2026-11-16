import type { ChatMessage, Settings } from './model.ts';
export type Generate = (settings: Settings, messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void) => Promise<string>;

export function requestBody(settings: Settings, messages: ChatMessage[]): Record<string, unknown> {
  if (settings.protocol === 'anthropic') return {
    model: settings.model, stream: true, max_tokens: settings.maxOutputTokens,
    system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
    messages: messages.filter(message => message.role !== 'system'),
    ...(settings.effort ? { thinking: { type: 'adaptive' }, output_config: { effort: settings.effort } } : {}),
  };
  if (settings.protocol === 'responses') return {
    model: settings.model, input: messages, stream: true, store: false,
    max_output_tokens: settings.maxOutputTokens,
    ...(settings.effort ? { reasoning: { effort: settings.effort } } : {}),
  };
  return { model: settings.model, messages, stream: true, [settings.tokenParameter ?? 'max_completion_tokens']: settings.maxOutputTokens,
    ...(settings.effort ? { reasoning_effort: settings.effort } : {}) };
}
export function requestUrl(settings: Settings): string { return `${settings.baseUrl}/${settings.protocol === 'responses' ? 'responses' : settings.protocol === 'anthropic' ? 'messages' : 'chat/completions'}`; }
export function requestHeaders(settings: Settings): Record<string, string> {
  return { ...settings.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    ...(settings.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01', ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}) } : settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) };
}
export function responseText(settings: Settings, value: Record<string, any>): string {
  if (value.error) throw new Error('模型接口返回错误，请检查配置');
  if (settings.protocol === 'responses') {
    if (value.status && value.status !== 'completed') throw new Error('模型未完成回答；请检查输出上限并重试');
    return value.output_text ?? value.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content?.filter(part => part.type === 'output_text').map(part => part.text ?? '') ?? []).join('') ?? '';
  }
  if (settings.protocol === 'anthropic') {
    if (!['end_turn', 'stop_sequence'].includes(value.stop_reason)) throw new Error('模型未完成回答；请检查输出上限并重试');
    return value.content?.filter((part: {type: string}) => part.type === 'text').map((part: {text: string}) => part.text).join('') ?? '';
  }
  if (value.choices?.[0]?.finish_reason && value.choices[0].finish_reason !== 'stop') throw new Error('模型未完成回答；请检查输出上限并重试');
  return value.choices?.[0]?.message?.content ?? '';
}
function errorMessage(status: number): string {
  if (status === 401 || status === 403) return '模型接口拒绝认证，请检查 API Key 和自定义请求头';
  if (status === 429) return '模型接口限流或额度不足，请稍后重试';
  if (status === 404) return '模型或接口地址不存在，请检查模型 ID、基础地址和协议';
  if (status === 400) return '接口不接受当前模型参数，请检查模型 ID、协议、推理强度与输出上限';
  return `模型接口失败（HTTP ${status}）`;
}
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // A CR at a chunk boundary must wait for the following LF.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const lines = block.split('\n');
        yield { event: lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? '',
          data: lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n') };
      }
      if (buffer.length > 2000000) throw new Error('模型事件超出大小限制');
      if (done) {
        if (buffer.trim() && !buffer.trim().startsWith(':')) throw new Error('模型事件流未完整结束');
        break;
      }
    }
  } finally { reader.releaseLock(); }
}
export const generate: Generate = async (settings, messages, signal, onText) => {
  const timedSignal = AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutSeconds * 1000)]);
  const response = await fetch(requestUrl(settings), {
    method: 'POST', headers: requestHeaders(settings), body: JSON.stringify(requestBody(settings, messages)), signal: timedSignal,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(errorMessage(response.status)); }
  if (!response.body) throw new Error('模型接口没有返回正文');
  let result = '', completed = false, anthropicStop = '';
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const raw = await response.text();
    if (raw.length > 500000) throw new Error('模型输出超出大小限制');
    const value = JSON.parse(raw);
    result = responseText(settings, value);
    if (typeof result !== 'string' || result.length > 160000) throw new Error('模型输出格式或长度不符合要求');
    onText(result); completed = true;
  } else for await (const event of sseEvents(response.body)) {
    if (!event.data || event.data === '[DONE]') continue;
    const item = JSON.parse(event.data);
    let delta = '';
    if (settings.protocol === 'responses') {
      const type = item.type ?? event.event;
      if (type === 'response.output_text.delta') delta = item.delta ?? '';
      if (type === 'response.completed') completed = true;
      if (['error', 'response.failed', 'response.incomplete'].includes(type))
        throw new Error('模型未完成回答；已保存生成片段，可调整配置后重试');
    } else if (settings.protocol === 'anthropic') {
      const type = item.type ?? event.event;
      if (type === 'error') throw new Error('模型事件流返回错误');
      if (type === 'content_block_start' && item.content_block?.type === 'text') delta = item.content_block.text ?? '';
      if (type === 'content_block_delta' && item.delta?.type === 'text_delta') delta = item.delta.text ?? '';
      if (type === 'message_delta' && item.delta?.stop_reason) {
        anthropicStop = item.delta.stop_reason;
        if (!['end_turn', 'stop_sequence'].includes(anthropicStop)) throw new Error('模型输出被截断或拒绝，请检查输出上限并重试');
      }
      if (type === 'message_stop') completed = ['end_turn', 'stop_sequence'].includes(anthropicStop);
    } else {
      const choice = item.choices?.[0];
      if (item.error) throw new Error('模型事件流返回错误');
      delta = choice?.delta?.content ?? '';
      if (choice?.finish_reason === 'stop') completed = true;
      else if (choice?.finish_reason) throw new Error('模型输出被截断或拒绝，请检查输出上限并重试');
    }
    if (typeof delta !== 'string') throw new Error('模型输出格式不符合要求');
    if (delta) { result += delta; if (result.length > 160000) throw new Error('模型输出超出大小限制'); onText(result); }
  }
  if (!completed) throw new Error('模型连接提前结束，已保存片段，但未计为完成');
  if (!result.trim()) throw new Error('模型未返回可显示的回答');
  return result;
};

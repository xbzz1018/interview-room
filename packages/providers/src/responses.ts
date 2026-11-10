import type OpenAI from 'openai'
import type { Response as ModelResponse, ResponseCreateParamsStreaming } from 'openai/resources/responses/responses'
import { ProviderResponseError, type ChatCompleteOptions, type ChatDriver, type ChatMessage, type ChatStreamOptions, type ChatUsage, type ResolvedLlmConfig } from '@techspar/core'

class EmptyResponseError extends ProviderResponseError {
  constructor() { super('模型服务返回空内容，请稍后再试或更换模型。') }
}

function requestBody(config: ResolvedLlmConfig, messages: readonly ChatMessage[], options?: ChatCompleteOptions): ResponseCreateParamsStreaming {
  const effort = config.reasoning_effort || undefined
  const input: ResponseCreateParamsStreaming['input'] = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role,
    content: message.content,
  }))
  return {
    model: config.model,
    instructions: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
    input,
    stream: true,
    store: false,
    ...(effort ? { reasoning: { effort } } : {}),
    // Leave the default temperature to the reasoning model; gateways may reject it even when effort is unset.
    ...(effort === 'none' ? { temperature: options?.temperature ?? config.temperature } : {}),
    ...(options?.maxTokens === undefined ? {} : { max_output_tokens: Math.max(options.maxTokens, effort === 'none' ? 0 : 32768) }),
    ...(options?.jsonMode ? { text: { format: { type: 'json_object' as const } } } : {}),
  }
}

function usageOf(response: ModelResponse): ChatUsage {
  return {
    promptTokens: response.usage?.input_tokens || 0,
    completionTokens: response.usage?.output_tokens || 0,
    cachedTokens: response.usage?.input_tokens_details?.cached_tokens || 0,
  }
}

function outputText(response: ModelResponse): string {
  return (response.output || []).flatMap(item => item.type === 'message'
    ? item.content.filter(part => part.type === 'output_text').map(part => part.text)
    : []).join('')
}

export function createResponsesDriver(client: OpenAI, config: ResolvedLlmConfig, retry: {
  retryDelaysMs: readonly number[]
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>
}): ChatDriver {
  async function* stream(messages: readonly ChatMessage[], signal: AbortSignal, options?: ChatStreamOptions & ChatCompleteOptions) {
    const events = await client.responses.create(requestBody(config, messages, options), { signal })
    let text = ''
    let terminal = false
    let usage: ChatUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
    try {
      for await (const event of events) {
        if (event.type === 'response.output_text.delta') {
          text += event.delta
          yield event.delta
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
          terminal = true
          usage = usageOf(event.response)
          if (event.type === 'response.failed') throw new ProviderResponseError(event.response.error?.message || '模型服务生成失败，请重试。')
          if (event.type === 'response.incomplete') {
            throw new ProviderResponseError(event.response.incomplete_details?.reason === 'max_output_tokens'
              ? '模型已耗尽本次输出预算，请调低推理强度后重试。'
              : '模型未完成回答，请重试。')
          }
          if (!text) {
            text = outputText(event.response)
            if (text) yield text
          }
          break
        } else if (event.type === 'error') {
          throw new ProviderResponseError(event.message || '模型服务返回错误。')
        }
      }
      signal.throwIfAborted()
      if (!terminal) throw new ProviderResponseError('模型响应中途断开，请重试。')
      if (!text.trim()) throw new EmptyResponseError()
    } finally {
      events.controller.abort()
      options?.onUsage?.(usage)
    }
  }

  return {
    stream,
    async complete(messages, signal, options) {
      const total: ChatUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
      for (let attempt = 0; attempt <= retry.retryDelaysMs.length; attempt++) {
        let text = ''
        try {
          for await (const chunk of stream(messages, signal, { ...options, onUsage(usage) {
            total.promptTokens += usage.promptTokens
            total.completionTokens += usage.completionTokens
            total.cachedTokens += usage.cachedTokens
          } })) text += chunk
          return { text, ...total }
        } catch (error) {
          if (!(error instanceof EmptyResponseError) || attempt === retry.retryDelaysMs.length) throw error
          await retry.sleep(retry.retryDelaysMs[attempt]!, signal)
        }
      }
      throw new EmptyResponseError()
    },
  }
}

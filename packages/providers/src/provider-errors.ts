import OpenAI from 'openai'
import { AppError, type ChatDriver } from '@techspar/core'

/** Upstream authentication errors must not log the user out of the local app. */
export function providerError(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted || error instanceof AppError) return error
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AppError('模型接口响应超时，请稍后重试；高推理强度可能需要更长时间。', 504, 'provider_timeout')
  if (error instanceof OpenAI.APIConnectionError) return new AppError('无法连接模型接口，请检查 API Base、网络和代理设置。', 502, 'provider_connection_failed')
  // The SDK's event iterator can surface a native fetch/socket error after
  // response headers arrived, without wrapping it in APIConnectionError.
  const network = error instanceof Error ? error as Error & { code?: string; cause?: { code?: string } } : undefined
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE', 'ConnectionRefused', 'ConnectionClosed'].includes(network?.code || network?.cause?.code || '')) {
    return new AppError('模型接口连接中断，请检查网络或代理后重试；已保存的训练记录可在历史中继续。', 502, 'provider_connection_failed')
  }
  if (network?.code === 'ETIMEDOUT') return new AppError('模型接口响应超时，请稍后重试。', 504, 'provider_timeout')
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return new AppError('模型接口拒绝授权，请检查 API Key、模型权限和附加请求头。', 502, 'provider_auth_failed')
    if (error.status === 429) return new AppError('模型接口限流或额度不足，请检查服务商余额与限额后重试。', 503, 'provider_rate_limited')
    if (error.status === 400 || error.status === 404 || error.status === 422) return new AppError('模型接口不接受当前请求，请检查模型 ID、API 兼容模式及推理强度是否受支持。', 502, 'provider_request_rejected')
    return new AppError('模型服务暂时不可用，请稍后重试。', 502, 'provider_unavailable')
  }
  return error
}

export function withProviderErrors(driver: ChatDriver): ChatDriver {
  return {
    async complete(messages, signal, options) {
      try { return await driver.complete(messages, signal, options) }
      catch (error) { throw providerError(error, signal) }
    },
    async *stream(messages, signal, options) {
      try { yield* driver.stream(messages, signal, options) }
      catch (error) { throw providerError(error, signal) }
    },
  }
}

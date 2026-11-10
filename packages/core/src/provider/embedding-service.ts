import type { RequestContext } from '../kernel/context.ts'
import { ProviderNotConfigured } from '../kernel/errors.ts'
import { embeddingModeOf, embeddingTarget, resolveEmbeddingConfig } from './config.ts'
import type { PlatformProviderConfig, ResolvedEmbeddingConfig } from './model.ts'
import type { EmbeddingDriver, EmbeddingDriverFactory, EmbeddingUseCases, ProviderSettingsRepository } from './ports.ts'

function cacheSignature(config: ResolvedEmbeddingConfig): string {
  return [
    config.backend,
    config.api_base,
    config.api_key,
    config.api_model,
    config.local_model,
    config.local_path,
    config.api_batch_size,
  ].join('|')
}

export class EmbeddingService implements EmbeddingUseCases {
  private readonly cache = new Map<string, { signature: string; driver: Promise<EmbeddingDriver> }>()

  constructor(
    private readonly settings: ProviderSettingsRepository,
    private readonly platform: PlatformProviderConfig,
    private readonly drivers: EmbeddingDriverFactory,
  ) {}

  private async config(context: RequestContext): Promise<ResolvedEmbeddingConfig> {
    const stored = context.userId ? await this.settings.loadProvider(context.userId) : undefined
    const config = resolveEmbeddingConfig(stored?.embedding, this.platform)
    if (embeddingModeOf(config) === 'api' && !config.api_key) throw new ProviderNotConfigured('Embedding')
    return config
  }

  async embed(context: RequestContext, texts: readonly string[]): Promise<readonly Float32Array[]> {
    if (!texts.length) return []
    const config = await this.config(context)
    const key = context.userId || '__global__'
    const signature = cacheSignature(config)
    let cached = this.cache.get(key)
    if (!cached || cached.signature !== signature) {
      cached = { signature, driver: this.drivers.create(config) }
      this.cache.set(key, cached)
    }
    let driver: EmbeddingDriver
    try {
      driver = await cached.driver
    } catch (error) {
      // A failed model download must not poison this user's cache until restart.
      // Keep a newer configuration/reset's entry if it replaced the failed promise.
      if (this.cache.get(key) === cached) this.cache.delete(key)
      throw error
    }
    return driver.embed(texts, context.signal)
  }

  async signature(context: RequestContext): Promise<string> {
    return embeddingTarget(await this.config(context))
  }

  reset(userId?: string): void {
    if (userId) this.cache.delete(userId)
    else this.cache.clear()
  }
}

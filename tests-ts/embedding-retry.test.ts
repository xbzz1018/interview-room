import { expect, test } from 'bun:test'
import { EmbeddingService, type ProviderSettingsRepository, type PlatformProviderConfig, type EmbeddingDriver } from '@techspar/core'

const context = { userId: 'qa', requestId: 'qa', signal: new AbortController().signal }
const platform: PlatformProviderConfig = { llm: { api_base: '', api_key: '', model: '' }, embedding: { api_base: '', api_key: '', api_model: '' }, dailyCallLimit: 0, tokenLimit: 0, tokenWindow: 'day' }
const driver: EmbeddingDriver = { async embed(texts) { return texts.map(() => Float32Array.from([1, 0])) } }
function settings(model: () => string): ProviderSettingsRepository {
  return {
    async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_endpoint: '', oss_bucket: '' }, embedding: { backend: 'local', local_model: model(), local_path: '', api_base: '', api_key: '', api_model: '', api_batch_size: 10 } } },
    async saveProvider() {}, async loadTraining() { return { num_questions: 5, divergence: 2 } }, async saveTraining() {},
    async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {},
  }
}

test('retries driver initialization after a transient failure without restarting', async () => {
  let calls = 0
  const service = new EmbeddingService(settings(() => 'model'), platform, { async create() { if (++calls === 1) throw new Error('download failed'); return driver } })
  await expect(service.embed(context, ['text'])).rejects.toThrow('download failed')
  expect(await service.embed(context, ['text'])).toEqual([Float32Array.from([1, 0])])
  await service.embed(context, ['again'])
  expect(calls).toBe(2)
})

test('concurrent embedding requests reuse one initialization', async () => {
  let calls = 0
  const service = new EmbeddingService(settings(() => 'model'), platform, { async create() { calls++; return driver } })
  await Promise.all([service.embed(context, ['a']), service.embed(context, ['b'])])
  expect(calls).toBe(1)
})

test('an old failed initialization does not evict a newer model', async () => {
  let model = 'old', calls = 0, rejectOld!: (error: Error) => void, started!: () => void
  const initialized = new Promise<void>(resolve => { started = resolve })
  const service = new EmbeddingService(settings(() => model), platform, {
    async create(config) { calls++; if (config.local_model === 'old') { started(); return new Promise<EmbeddingDriver>((_, reject) => { rejectOld = reject }) } return driver },
  })
  const old = service.embed(context, ['old']).catch(error => error)
  await initialized
  model = 'new'; await service.embed(context, ['new'])
  rejectOld(new Error('old failed')); await old
  await service.embed(context, ['new again'])
  expect(calls).toBe(2)
})

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  InterviewService, ProfileService, ResumeInterviewEngine, USER_PROVIDER,
  type CandidateProfilePort, type ChatCompleteOptions, type ChatMessage,
  type ChatStreamOptions, type InterviewDependencies, type RequestContext,
  type ResumeInterviewState, type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository, BunKnowledgeVectorRepository, BunResumeInterviewStateRepository } from '@techspar/db'
import { FileCandidateProfileRepository, FileProviderSettingsRepository } from '@techspar/platform'
import { OpenAiChatDriverFactory } from '@techspar/providers'

// Synthetic evidence only. Read existing credentials without changing settings;
// require explicit opt-in before spending the configured gateway's quota.
if (!process.argv.includes('--live')) throw new Error('Pass --live to run synthetic live latency checks.')
const source = process.env.TECHSPAR_SMOKE_PROVIDER_DATA_DIR
if (!source) throw new Error('TECHSPAR_SMOKE_PROVIDER_DATA_DIR is required.')
const db = new Database(join(source, 'interviews.db'), { readonly: true })
const user = db.query<{ id: string }, [string]>('SELECT id FROM users WHERE email = ?').get(process.env.TECHSPAR_SMOKE_EMAIL || 'admin@techspar.local')
db.close()
if (!user) throw new Error('Source user not found')
const stored = await new FileProviderSettingsRepository(source).loadProvider(user.id)
if (!stored.llm?.api_key || stored.llm.compatibility !== 'responses') throw new Error('A configured Responses provider is required.')
const config = { ...stored.llm, source: USER_PROVIDER }
const secrets = [config.api_key, ...Object.values(config.http_headers || {})].filter(Boolean)
const clean = (error: unknown) => secrets.reduce((value, secret) => value.split(secret).join('[redacted]'), String(error)).slice(0, 1000)
const directory = resolve('local_tools', `latency-${Date.now()}`)
await mkdir(directory, { recursive: true })
type Call = { scenario: string; model: string; effort?: string; requestBytes: number; firstTextMs?: number; elapsedMs?: number; textChars: number; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedTokens?: number }
const calls: Call[] = []
const results: Array<{ scenario: string; elapsedMs: number; ok: boolean; modelCalls: number; reportChars?: number; error?: string }> = []
let scenario = ''
const factory = new OpenAiChatDriverFactory({ fetch: (async (input, init) => {
  const body = String(init?.body || '{}'), request = JSON.parse(body)
  const call: Call = { scenario, model: request.model, effort: request.reasoning?.effort, requestBytes: new TextEncoder().encode(body).length, textChars: 0 }
  calls.push(call)
  const begin = performance.now()
  const response = await fetch(input, init)
  if (!response.body || !response.ok) return response
  let pending = ''
  const decoder = new TextDecoder()
  const observe = (line: string) => {
    if (!line.startsWith('data:')) return
    try {
      const event = JSON.parse(line.slice(5))
      if (event.type === 'response.output_text.delta' && event.delta) {
        call.firstTextMs ??= Math.round(performance.now() - begin)
        call.textChars += event.delta.length
      }
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
        call.elapsedMs = Math.round(performance.now() - begin)
        const usage = event.response?.usage
        call.inputTokens = usage?.input_tokens
        call.outputTokens = usage?.output_tokens
        call.reasoningTokens = usage?.output_tokens_details?.reasoning_tokens
        call.cachedTokens = usage?.input_tokens_details?.cached_tokens
      }
    } catch { /* SSE comments and [DONE] carry no metrics. */ }
  }
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n'); pending = lines.pop() || ''
      lines.forEach(observe)
      controller.enqueue(chunk)
    },
    flush() { pending += decoder.decode(); observe(pending) },
  }))
  return new Response(stream, { status: response.status, headers: response.headers })
}) as typeof fetch })
const makeAi = (effort = config.reasoning_effort): TextGenerationUseCases => ({
  async complete(context: RequestContext, messages: readonly ChatMessage[], options?: ChatCompleteOptions) {
    return (await factory.create({ ...config, reasoning_effort: effort }).complete(messages, context.signal, options)).text
  },
  async *stream(context: RequestContext, messages: readonly ChatMessage[], options?: ChatStreamOptions) {
    yield* factory.create({ ...config, reasoning_effort: effort }).stream(messages, context.signal, options)
  },
})
const state: ResumeInterviewState = {
  target_role: 'Java 后端开发工程师', job_description: '开发订单系统；要求数据库事务、消息队列、幂等和故障恢复。',
  resume_context: '虚构候选人，个人练习项目：Java、Spring Boot、PostgreSQL 订单接口，使用唯一约束和幂等键。没有实际生产流量或线上收益数据。',
  phase: 'technical', phase_question_count: 2, is_finished: false,
  messages: [
    { role: 'assistant', content: '请介绍你的订单练习项目和个人负责的工作。' },
    { role: 'user', content: '我用 Spring Boot 和 PostgreSQL 写了订单接口，做了创建和查询。这是个人练习，不是生产系统。' },
    { role: 'assistant', content: '并发创建订单时，怎样避免同一个请求写入两条记录？' },
    { role: 'user', content: '我给请求配置幂等键，数据库上设唯一约束。我用两个并发请求验证只能生成一笔订单，但没有测高并发容量。' },
    { role: 'assistant', content: '数据库事务提交成功，但是消息发送失败时，你会怎么处理？' },
    { role: 'user', content: '我知道可以用本地消息表，在同一事务中写订单和消息，然后后台发送。实际项目还没实现消息表，也没有验证重复投递和恢复。' },
  ],
  questions_asked: ['介绍订单练习项目', '如何防止并发重复写入', '事务和消息的一致性'],
  last_eval: { score: 6, should_advance: false },
  eval_history: [
    { phase: 'project_deep_dive', score: 7, brief: '清楚区分练习与生产经历', evidence: '这是个人练习，不是生产系统' },
    { phase: 'technical', score: 7, brief: '知道幂等键和唯一约束，有小规模并发验证', evidence: '两个并发请求验证只能生成一笔订单' },
    { phase: 'technical', score: 6, brief: '知道消息表方案但尚未实现故障验证', evidence: '没有验证重复投递和恢复' },
  ],
}
const tasks: InterviewDependencies['tasks'] = { async enqueue() { throw new Error('Unexpected enqueue') }, async get() { return undefined } }
const knowledgeStore: InterviewDependencies['knowledgeStore'] = { async loadTopics() { return {} }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {} }
const resume: InterviewDependencies['resume'] = { async text() { return state.resume_context }, async status() { return { has_resume: true, filename: 'synthetic.txt', size: state.resume_context.length } }, async file() { throw new Error('unused') }, async upload() { throw new Error('unused') }, async delete() { throw new Error('unused') }, async parse() { throw new Error('unused') }, async transcribe() { throw new Error('unused') } }

async function measure(label: string, action: () => Promise<{ reportChars?: number } | void>) {
  scenario = label
  const begin = performance.now(), startCalls = calls.length
  try {
    const value = await action()
    results.push({ scenario, elapsedMs: Math.round(performance.now() - begin), ok: true, modelCalls: calls.length - startCalls, ...value })
  } catch (error) {
    results.push({ scenario, elapsedMs: Math.round(performance.now() - begin), ok: false, modelCalls: calls.length - startCalls, error: clean(error) })
  }
  const output = { model: config.model, configuredEffort: config.reasoning_effort, synthetic: true, embedding: 'deterministic stub to isolate model latency', results, calls }
  await writeFile(join(directory, 'result.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(results.at(-1)))
}

for (const combined of process.argv.includes('--interview-only') ? [] : [false, true]) {
  await measure(combined ? 'combined-review' : 'baseline-two-call-review', async () => {
    const base = join(directory, combined ? 'combined' : 'baseline'), path = join(base, 'interviews.db')
    await mkdir(base, { recursive: true })
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const vectors = new BunKnowledgeVectorRepository(path); vectors.initialize()
    try {
      const ai = makeAi(), repository = new FileCandidateProfileRepository(base)
      const profile = new ProfileService({ repository, sessions, tasks, ai, vectors, resume, knowledgeStore,
        embeddings: { async embed(_context, texts) { return texts.map(() => Float32Array.from([1, 0])) }, async signature() { return 'benchmark-stub' }, reset() {} },
      })
      const candidateProfile: CandidateProfilePort = combined ? profile : {
        summary: profile.summary.bind(profile), targetRole: profile.targetRole.bind(profile), updateTargetRole: profile.updateTargetRole.bind(profile), afterReview: profile.afterReview.bind(profile),
      }
      const service = new InterviewService({ sessions, states, ai, tasks, profile: candidateProfile, resume, knowledgeStore,
        ids: { next: () => 'synthetic' }, settings: new FileProviderSettingsRepository(base), knowledge: { async context() { return '' } },
      })
      await sessions.create({ sessionId: 'review', userId: 'qa', mode: 'resume' })
      for (const message of state.messages) await sessions.appendMessage('review', 'qa', message.role, message.content)
      await states.save('review', 'qa', structuredClone(state))
      await service.runReviewTask({ task_id: 'review', user_id: 'qa', type: 'resume_review', status: 'running', payload: {}, result: null, error: null, attempts: 1, created_at: '', updated_at: '', signal: AbortSignal.timeout(300000) })
      const saved = await sessions.get('review', 'qa'), savedProfile = await repository.load('qa')
      if (!saved?.review || saved.meta.profile_extract_failed !== false || savedProfile.stats.total_sessions !== 1 || !Object.keys(saved.overall.dimension_scores || {}).length) throw new Error('Review/profile validation failed')
      return { reportChars: saved.review.length }
    } finally { sessions.close(); states.close(); vectors.close() }
  })
}

if (process.argv.includes('--compare-effort')) {
  // Compare explicit test configurations in memory; the user's saved settings
  // remain unchanged. Reversed order reduces, but cannot eliminate, warm-up bias.
  for (const [index, effort] of (['xhigh', 'medium', 'medium', 'xhigh'] as const).entries()) {
    await measure(`interview-${effort}-${index + 1}`, async () => {
      const candidateProfile: CandidateProfilePort = { async summary() { return '练习数据库事务与消息一致性。' }, async targetRole() { return '' }, async updateTargetRole() {} }
      const states = { async initialize() {}, async load() { return undefined }, async save() {}, async delete() {} }
      const engine = new ResumeInterviewEngine(makeAi(effort), states, candidateProfile)
      let text = ''
      for await (const event of engine.stream({ requestId: scenario, userId: 'qa', signal: AbortSignal.timeout(120000) }, 'turn', structuredClone(state), '如果后台重复投递消息，我考虑消费端也记录消息 ID 去重，但还不清楚消息发送成功、更新状态前崩溃怎么恢复。')) if ('token' in event) text += event.token
      if (!text.trim() || text.includes('<!--EVAL:')) throw new Error('No usable visible interview reply')
    })
  }
}
console.log(JSON.stringify({ result: join(directory, 'result.json'), passed: results.filter(value => value.ok).length, failed: results.filter(value => !value.ok).length }))
if (results.some(value => !value.ok)) process.exitCode = 1

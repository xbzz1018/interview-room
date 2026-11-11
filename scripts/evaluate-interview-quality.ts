import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { InterviewService, ProfileService, ResumeInterviewEngine, ProjectEvidenceService, USER_PROVIDER, type CandidateProfilePort, type ChatCompleteOptions, type ChatMessage, type ChatStreamOptions, type InterviewDependencies, type RequestContext, type ResumeInterviewState, type TextGenerationUseCases } from '@techspar/core'
import { BunInterviewSessionRepository, BunKnowledgeVectorRepository, BunResumeInterviewStateRepository } from '@techspar/db'
import { FileCandidateProfileRepository, FileProviderSettingsRepository, FileProjectEvidenceStore } from '@techspar/platform'
import { OpenAiChatDriverFactory } from '@techspar/providers'
if (!process.argv.includes('--live')) throw new Error('Pass --live to run synthetic real-model evaluation')
const source = process.env.TECHSPAR_SMOKE_PROVIDER_DATA_DIR
if (!source) throw new Error('TECHSPAR_SMOKE_PROVIDER_DATA_DIR is required')
const db = new Database(join(source, 'interviews.db'), { readonly: true })
const user = db.query<{ id: string }, [string]>('SELECT id FROM users WHERE email = ?').get(process.env.TECHSPAR_SMOKE_EMAIL || 'admin@techspar.local'); db.close()
if (!user) throw new Error('Source user not found')
const stored = await new FileProviderSettingsRepository(source).loadProvider(user.id)
if (!stored.llm?.api_key || stored.llm.compatibility !== 'responses') throw new Error('Configured Responses provider required')
const config = { ...stored.llm, source: USER_PROVIDER }
const secrets = [config.api_key, ...Object.values(config.http_headers || {})].filter(Boolean)
const clean = (error: unknown) => secrets.reduce((value, secret) => value.split(secret).join('[redacted]'), String(error)).slice(0, 1000)
const directory = resolve('local_tools', `quality-${Date.now()}`); await mkdir(directory, { recursive: true })
const calls: Array<{ scenario: string; firstTextMs?: number; totalMs?: number; inputTokens?: number; outputTokens?: number; reasoningTokens?: number }> = []
const results: Array<Record<string, unknown>> = []
let scenario = ''
const factory = new OpenAiChatDriverFactory({ fetch: (async (input, init) => {
  const call: typeof calls[number] = { scenario }; calls.push(call)
  const started = performance.now(), response = await fetch(input, init)
  if (!response.ok || !response.body) return response
  const decoder = new TextDecoder(); let pending = ''
  function observe(line: string) {
    if (!line.startsWith('data:')) return
    try {
      const event = JSON.parse(line.slice(5))
      if (event.type === 'response.output_text.delta' && event.delta) call.firstTextMs ??= Math.round(performance.now() - started)
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
        call.totalMs = Math.round(performance.now() - started)
        call.inputTokens = event.response?.usage?.input_tokens; call.outputTokens = event.response?.usage?.output_tokens; call.reasoningTokens = event.response?.usage?.output_tokens_details?.reasoning_tokens
      }
    } catch { /* SSE control lines */ }
  }
  return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { pending += decoder.decode(chunk, { stream: true }); const lines = pending.split('\n'); pending = lines.pop() || ''; lines.forEach(observe); controller.enqueue(chunk) }, flush() { observe(pending + decoder.decode()) } })), { status: response.status, headers: response.headers })
}) as typeof fetch })
const ai: TextGenerationUseCases = {
  async complete(context: RequestContext, messages: readonly ChatMessage[], options?: ChatCompleteOptions) { const text = (await factory.create(config).complete(messages, context.signal, options)).text; await writeFile(join(directory, `completion-${calls.length}.json`), JSON.stringify({ scenario, messages, text }, null, 2)); return text },
  async *stream(context: RequestContext, messages: readonly ChatMessage[], options?: ChatStreamOptions) { yield* factory.create(config).stream(messages, context.signal, options) },
}
const context = (): RequestContext => ({ userId: 'qa', requestId: scenario, signal: AbortSignal.timeout(300000) })
const state: ResumeInterviewState = {
  target_role: '后端开发工程师', job_description: '订单服务、事务、幂等与故障恢复。', resume_context: '虚构候选人，Atlas Python 是个人练习：PostgreSQL 订单接口。本人实现创建和查询、唯一约束。没有生产流量数据。消息表只是学习方案，尚未实现。',
  phase: 'technical', phase_question_count: 2, is_finished: false, training_mode: 'strict',
  messages: [
    { role: 'assistant', content: '请介绍 Atlas Python 项目与个人负责的工作。' }, { role: 'user', content: '这是个人练习，做了创建查询和唯一约束，没有生产流量。' },
    { role: 'assistant', content: 'Atlas Python 如何避免重复订单？' }, { role: 'user', content: '先查询有没有，再写入。我还没有做并发压测。' },
    { role: 'assistant', content: '事务成功而消息发送失败怎么办？' }, { role: 'user', content: '知道可以在同一事务写消息表，再后台发送，但项目还没实现，也没有恢复测试。' },
  ], questions_asked: ['介绍 Atlas Python 项目', 'Atlas Python 如何避免重复订单', '事务和消息一致性'], last_eval: { score: 5, should_advance: false }, eval_history: [],
}
const path = join(directory, 'interviews.db'), sessions = new BunInterviewSessionRepository(path), states = new BunResumeInterviewStateRepository(path), vectors = new BunKnowledgeVectorRepository(path)
sessions.initialize(); states.initialize(); vectors.initialize()
const tasks: InterviewDependencies['tasks'] = { async enqueue() { throw new Error('Unexpected enqueue') }, async get() { return undefined } }
const knowledgeStore: InterviewDependencies['knowledgeStore'] = { async loadTopics() { return {} }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {} }
const resume: InterviewDependencies['resume'] = { async text() { return state.resume_context }, async status() { return { has_resume: true, filename: 'synthetic.txt', size: state.resume_context.length } }, async file() { throw new Error('unused') }, async upload() { throw new Error('unused') }, async delete() { throw new Error('unused') }, async parse() { throw new Error('unused') }, async transcribe() { throw new Error('unused') } }
const repository = new FileCandidateProfileRepository(directory)
const profile = new ProfileService({ repository, sessions, tasks, ai, vectors, resume, knowledgeStore, embeddings: { async embed(_context, texts) { return texts.map(() => Float32Array.from([1, 0])) }, async signature() { return 'synthetic-no-retrieval-embedding' }, reset() {} } })
const evidence = new ProjectEvidenceService(new FileProjectEvidenceStore(directory))
await evidence.import(context(), { project_id: 'atlas-python', name: 'Atlas Python', aliases: ['Atlas Python'], sources: [{ source_id: 'orders', path: 'orders.sql', kind: 'personal_reproduction', sha256: 'a'.repeat(64), revision: 'synthetic-v1', start_line: 1, topics: ['订单','唯一约束','幂等','并发'], notes: '合成练习代码，不是生产经历，未跑压测。', content: '-- Atlas Python 练习实现\nCREATE TABLE orders (id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL);\n-- 重复创建由唯一约束拦截。先查询再插入仍有并发竞态。\n-- 消息表尚未实现，未记录任何 QPS。' }] })
await evidence.import(context(), { project_id: 'atlas-java', name: 'Atlas Java', aliases: ['Atlas Java'], sources: [{ source_id: 'other-version', path: 'other.md', kind: 'reference_material', sha256: 'b'.repeat(64), revision: 'synthetic-other-version', start_line: 1, topics: ['订单','幂等'], notes: '不同项目版本，不属于 Atlas Python。', content: 'Atlas Java 的示例声明 9999 QPS。这个数字与 Python 项目无关，不得用于 Python 参考答法。' }] })
const service = new InterviewService({ sessions, states, tasks, ai, profile, resume, knowledgeStore, evidence, ids: { next: () => crypto.randomUUID() }, settings: new FileProviderSettingsRepository(directory), knowledge: { async context() { return '' } } })
async function persist() { await writeFile(join(directory, 'result.json'), JSON.stringify({ model: config.model, reasoningEffort: config.reasoning_effort, protocol: config.compatibility, synthetic: true, realEmbeddingEvaluation: false, results, calls }, null, 2)) }
async function measure(label: string, action: () => Promise<Record<string, unknown>>) {
  scenario = label; const started = performance.now(), before = calls.length
  try { results.push({ scenario: label, ok: true, elapsedMs: Math.round(performance.now() - started), ...await action() }); results.at(-1)!.elapsedMs = Math.round(performance.now() - started) }
  catch (error) { results.push({ scenario: label, ok: false, elapsedMs: Math.round(performance.now() - started), error: clean(error) }) }
  results.at(-1)!.modelCalls = calls.length - before; await persist(); console.log(JSON.stringify(results.at(-1)))
}
async function fixture(id: string, question?: string, snapshot = state.resume_context, projectIds = ['atlas-python','atlas-java']) {
  const messages = question ? [{ role: 'assistant' as const, content: question }, { role: 'user' as const, content: '这部分的具体配置和运行结果我不清楚。' }] : state.messages
  await sessions.create({ sessionId: id, userId: 'qa', mode: 'resume', meta: { training_mode: 'strict', evidence_projects: await evidence.select(context(), projectIds) } })
  for (const message of messages) await sessions.appendMessage(id, 'qa', message.role, message.content)
  await states.save(id, 'qa', { ...structuredClone(state), resume_context: snapshot, messages })
  await sessions.updateStatus(id, 'qa', 'ended')
}
try {
  await fixture('review')
  await measure('full-staged-review', async () => {
    await service.runReviewTask({ task_id: 'review', user_id: 'qa', type: 'resume_review', status: 'running', payload: {}, attempts: 1, created_at: '', updated_at: '', signal: context().signal })
    const saved = (await sessions.get('review', 'qa'))!, person = await repository.load('qa')
    await writeFile(join(directory, 'review.md'), saved.review || '')
    const meta = saved.meta
    if (!saved.review || meta.profile_extract_failed !== false || person.stats.total_sessions !== 1) throw new Error('Report/profile persistence failed')
    return { reportChars: saved.review.length, stages: { started: meta.review_started_at, firstText: meta.review_first_token_at, reportReady: meta.review_report_ready_at, completed: meta.review_completed_at }, humanReviewRequired: true }
  })
  if (process.argv.includes('--review-only')) { console.log(JSON.stringify({ directory, reviewOnly: true })); process.exitCode = results.some(result => !result.ok) ? 1 : 0 }
  else {
  await measure('reference-correct-project-and-concurrency', async () => {
    const answer = await service.referenceAnswer(context(), 'review', 'resume-turn-3')
    await writeFile(join(directory, 'reference-correct-project.md'), answer.reference_answer)
    const sources = answer.sources || []
    if (!sources.length || sources.some(source => source.project_id !== 'atlas-python') || answer.reference_answer.includes('9999')) throw new Error('Project/version isolation failed')
    const replay = await service.referenceAnswer(context(), 'review', 'resume-turn-3')
    if (!replay.cached || replay.reference_answer !== answer.reference_answer) throw new Error('Reference replay failed')
    return { validCitations: sources.length, cachedReplay: true, humanReviewRequired: true }
  })
  await fixture('missing-device', '这个量化模型运行在哪款手机？22ms 是怎么测出来的？', '虚构端侧学习练习。未提供手机型号、测量脚本、原始日志或样本量。', [])
  await measure('reference-missing-historical-facts', async () => {
    const answer = await service.referenceAnswer(context(), 'missing-device', 'resume-turn-1')
    await writeFile(join(directory, 'reference-missing-facts.md'), answer.reference_answer)
    if (answer.sources?.length || !/待补充|未提供|无法确认|没有.*(资料|记录|证据)/.test(answer.reference_answer)) throw new Error('Missing-fact boundary check failed')
    return { noInventedCitation: true, acknowledgesMissingFacts: true, humanReviewRequired: true }
  })
  await fixture('no-source', 'Android QNN 的 AHardwareBuffer 注册链路是什么？', '虚构候选人只有订单练习，没有端侧部署经历。', ['atlas-python'])
  await measure('reference-no-relevant-source', async () => {
    const answer = await service.referenceAnswer(context(), 'no-source', 'resume-turn-1')
    await writeFile(join(directory, 'reference-no-source.md'), answer.reference_answer)
    if (answer.sources?.length || /\[S\d+\]/.test(answer.reference_answer)) throw new Error('Unrelated source cited')
    return { noUnrelatedCitation: true, humanReviewRequired: true }
  })
  await measure('retry-after-reference', async () => {
    const input = '先查询再写入有并发竞态。我会在 idempotency_key 上加唯一约束，冲突时返回原订单；同一键不同请求内容应报冲突。这是个人练习，还没完成并发和故障测试。'
    const answer = await service.compareAnswer(context(), 'review', 'resume-turn-3', input, crypto.randomUUID())
    await writeFile(join(directory, 'retry.json'), JSON.stringify(answer, null, 2))
    return { technicalGaps: answer.technical_gaps.length, expressionGaps: answer.expression_gaps.length, humanReviewRequired: true }
  })
  for (const mode of ['strict','coach'] as const) await measure(`interview-${mode}`, async () => {
    const engine = new ResumeInterviewEngine(ai, states, { async summary() { return '' }, async targetRole() { return '' }, async updateTargetRole() {} } satisfies CandidateProfilePort)
    let output = ''
    for await (const event of engine.stream(context(), `turn-${mode}`, { ...structuredClone(state), training_mode: mode }, '这题我不会，请直接告诉我正确答案再让我重答。')) if ('token' in event) output += event.token
    if (!output.trim() || output.includes('<!--EVAL:')) throw new Error('No usable interview response')
    await writeFile(join(directory, `interview-${mode}.md`), output)
    return { outputChars: output.length, humanReviewRequired: true }
  })
  }
} finally { await persist(); sessions.close(); states.close(); vectors.close() }
console.log(JSON.stringify({ directory, passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length }))
if (results.some(result => !result.ok)) process.exitCode = 1

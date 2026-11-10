import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  InterviewService,
  PersistentTaskQueue,
  ProfileService,
  ResumeInterviewEngine,
  type CandidateProfilePort,
  type ChatCompleteOptions,
  type ChatMessage,
  type InterviewDependencies,
  type KnowledgeStore,
  type PersistentTaskDispatcher,
  type RequestContext,
  type TaskRecord,
  type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository, BunKnowledgeVectorRepository, BunResumeInterviewStateRepository, BunTaskRepository } from '@techspar/db'
import { FileCandidateProfileRepository } from '@techspar/platform'

const directories: string[] = []
async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-interview-'))
  directories.push(directory)
  return join(directory, 'techspar.db')
}
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })

const context: RequestContext = { requestId: 'test', userId: 'user-a', signal: new AbortController().signal }

class FakeAi implements TextGenerationUseCases {
  calls: ChatMessage[][] = []
  options: Array<ChatCompleteOptions | undefined> = []
  constructor(private readonly replies: string[]) {}
  async complete(_context: RequestContext, messages: readonly ChatMessage[], options?: ChatCompleteOptions): Promise<string> {
    this.calls.push([...messages])
    this.options.push(options)
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error('Unexpected LLM call')
    return reply
  }
  async *stream(_context: RequestContext, messages: readonly ChatMessage[]): AsyncIterable<string> {
    const reply = await this.complete(_context, messages)
    for (const chunk of reply.match(/.{1,7}/gs) || []) yield chunk
  }
}

const profile: CandidateProfilePort = {
  async summary() { return '后端经验较强' },
  async targetRole() { return '' },
  async updateTargetRole() {},
}

function taskDispatcher(dispatched: TaskRecord[] = []): PersistentTaskDispatcher {
  return {
    async enqueue(input) {
      const task = { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending' as const, payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' }
      dispatched.push(task)
      return task
    },
    async get(taskId, userId) { return dispatched.find((task) => task.task_id === taskId && task.user_id === userId) },
  }
}

function emptyKnowledgeStore(topics: Awaited<ReturnType<KnowledgeStore['loadTopics']>> = {}): KnowledgeStore {
  return {
    async loadTopics() { return topics }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {},
  }
}

function interviewDependencies(input: {
  sessions: InterviewDependencies['sessions']
  states: InterviewDependencies['states']
  ai: TextGenerationUseCases
  tasks?: PersistentTaskDispatcher
  knowledgeStore?: KnowledgeStore
  candidateProfile?: CandidateProfilePort
}): InterviewDependencies {
  return {
    sessions: input.sessions,
    states: input.states,
    tasks: input.tasks || taskDispatcher(),
    ids: { next: () => 'generated-session' },
    ai: input.ai,
    resume: { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } },
    knowledge: { async context() { return '' } },
    knowledgeStore: input.knowledgeStore || emptyKnowledgeStore(),
    settings: { async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }, async saveProvider() {}, async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {} },
    profile: input.candidateProfile || profile,
  }
}

describe('interview persistence', () => {
  test('legacy resume reviews expose answered questions and generate cached, evidence-bound reference answers', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path)
    const ai = new FakeAi(['## 回答框架\n先说明事实，再解释验证方法。'])
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))
    await service.start(context, { mode: 'resume', target_role: '后端工程师', job_description: '负责数据库与 API' })
    await sessions.appendMessage('generated-session', 'user-a', 'user', '我用 AI 辅助实现，负责测试与复核。')
    await sessions.appendMessage('generated-session', 'user-a', 'assistant', '如何验证并发安全？')
    await sessions.appendMessage('generated-session', 'user-a', 'user', '用并发请求和唯一约束验证。')
    await sessions.appendMessage('generated-session', 'user-a', 'assistant', '还遇到什么问题？')
    await sessions.saveReview({ sessionId: 'generated-session', userId: 'user-a', review: '# 已保存复盘' })
    const review = await service.review(context, 'generated-session')
    expect(review.questions.map(question => question.id)).toEqual(['resume-turn-1', 'resume-turn-3'])
    expect((await sessions.get('generated-session', 'user-a'))!.questions).toEqual([])
    const result = await service.referenceAnswer(context, 'generated-session', 'resume-turn-3')
    expect(result).toEqual({ reference_answer: '## 回答框架\n先说明事实，再解释验证方法。', cached: false })
    const prompt = ai.calls[0]!
    expect(prompt[0]!.content).toContain('不编造成候选人做过的事')
    expect(JSON.parse(prompt[1]!.content)).toMatchObject({ target_role: '后端工程师', question: '如何验证并发安全？', candidate_answer: '用并发请求和唯一约束验证。' })
    expect(await service.referenceAnswer(context, 'generated-session', 'resume-turn-3')).toMatchObject({ cached: true })
    expect(ai.calls).toHaveLength(1)
    await expect(service.referenceAnswer({ ...context, userId: 'another-user' }, 'generated-session', 'resume-turn-3')).rejects.toThrow('Session not found')
    await expect(service.referenceAnswer(context, 'generated-session', 'resume-turn-5')).rejects.toThrow('Question not found')
    sessions.close(); states.close()
  })

  test('failed generation retries the pending answer once and blocks overlapping turns and ending', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path)
    let release!: (text: string) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let calls = 0
    const ai: TextGenerationUseCases = {
      async complete() {
        calls++
        if (calls === 1) throw new Error('temporary upstream failure')
        entered()
        return new Promise<string>(resolve => { release = resolve })
      },
      async *stream() {},
    }
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))
    await service.start(context, { mode: 'resume', target_role: '后端工程师' })
    await expect(service.chat(context, 'generated-session', '我的回答')).rejects.toThrow('temporary upstream failure')
    const pending = service.chat(context, 'generated-session', '我的回答')
    await started
    await expect(service.chat(context, 'generated-session', '重复提交')).rejects.toThrow('面试官正在处理')
    await expect(service.end(context, 'generated-session', [])).rejects.toThrow('面试官仍在回复')
    release('请具体说明验证方法。')
    await pending
    const session = (await sessions.get('generated-session', 'user-a'))!
    expect(session.transcript.map(message => message.role)).toEqual(['assistant', 'user', 'assistant'])
    expect((await states.load('generated-session', 'user-a'))!.messages).toHaveLength(3)
    await sessions.updateStatus('generated-session', 'user-a', 'ended')
    await expect(service.chat(context, 'generated-session', '不能再提交')).rejects.toThrow('这轮面试已结束')
    sessions.close(); states.close()
  })

  test('ongoing resume interviews cannot request reference answers', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path)
    const ai = new FakeAi([])
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))
    await service.start(context, { mode: 'resume', target_role: '后端工程师' })
    await sessions.appendMessage('generated-session', 'user-a', 'user', '我的经历')
    await expect(service.referenceAnswer(context, 'generated-session', 'resume-turn-1')).rejects.toThrow('请结束面试')
    expect(ai.calls).toHaveLength(0)
    sessions.close(); states.close()
  })

  test('keeps session JSON compatible and user-scoped', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path)
    sessions.initialize()
    await sessions.create({ sessionId: 's1', userId: 'user-a', mode: 'topic_drill', topic: 'python', questions: [{ id: 1, question: '为什么需要 GIL？' }], meta: { source: 'test' } })
    await sessions.saveAnswers('s1', 'user-a', [{ question_id: 1, answer: '保护解释器内部状态' }])
    expect((await sessions.get('s1', 'user-a'))?.transcript.map((message) => message.role)).toEqual(['assistant', 'user'])
    expect(await sessions.get('s1', 'user-b')).toBeUndefined()
    expect(await sessions.delete('s1', 'user-b')).toBeFalse()
    sessions.close()
  })

  test('hides untouched sessions but keeps drafts resumable', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path)
    sessions.initialize()
    await sessions.create({ sessionId: 'empty', userId: 'user-a', mode: 'topic_drill', topic: 'ts' })
    await sessions.create({ sessionId: 'draft', userId: 'user-a', mode: 'topic_drill', topic: 'ts', questions: [{ id: 1, question: '解释结构类型' }] })
    await sessions.saveAnswers('draft', 'user-a', [{ question_id: 1, answer: '按成员兼容' }])
    const history = await sessions.list({ userId: 'user-a', limit: 20, offset: 0 })
    expect(history.items.map((item) => item.session_id)).toEqual(['draft'])
    sessions.close()
  })

  test('persists and recovers pending jobs after a new queue starts', async () => {
    const path = await databasePath()
    const first = new BunTaskRepository(path)
    first.initialize()
    await first.upsert({ taskId: 'review-1', userId: 'user-a', type: 'review', payload: { session_id: 'review-1' } })
    first.close()

    const reopened = new BunTaskRepository(path)
    reopened.initialize()
    const queue = new PersistentTaskQueue(reopened)
    queue.register('review', async () => ({ restored: true }))
    await queue.start()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await reopened.get('review-1', 'user-a'))?.status === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await reopened.get('review-1', 'user-a')).toMatchObject({ status: 'done', attempts: 1, result: { restored: true } })
    reopened.close()
  })
})

describe('resume interview state machine', () => {
  for (const output of ['{"score":11,"should_advance":true}', '{"score":7,"should_advance":"true"}', '{"score":null}', '{"brief":[]}', 'null', '{"score":']) {
    for (const streaming of [false, true]) test(`discards invalid evaluation ${output} (stream=${streaming}) before state persistence`, async () => {
      const states = new BunResumeInterviewStateRepository(await databasePath()); states.initialize()
      const engine = new ResumeInterviewEngine(new FakeAi([`继续介绍项目。<!--EVAL:${output}${output.endsWith(':') ? '' : '-->'}`]), states, profile)
      const state = { messages: [], phase: 'technical' as const, target_role: '后端', job_description: '', resume_context: '', questions_asked: [], phase_question_count: 0, is_finished: false, last_eval: { score: 8, should_advance: true }, eval_history: [] }
      try {
        let visible = ''
        if (streaming) {
          for await (const event of engine.stream(context, 'invalid-eval', state, '回答')) if ('token' in event) visible += event.token
        } else visible = (await engine.turn(context, 'invalid-eval', state, '回答')).message
        expect(visible).toBe('继续介绍项目。')
        const stored = await states.load('invalid-eval', 'user-a')
        expect(stored).toMatchObject({ phase: 'technical', last_eval: {}, eval_history: [] })
        expect(stored?.messages.at(-1)?.content).toBe('继续介绍项目。')
      } finally { states.close() }
    })
  }

  test('starts locally without a model call and uses the full role, JD and resume on the first follow-up', async () => {
    const path = await databasePath()
    const states = new BunResumeInterviewStateRepository(path)
    states.initialize()
    const ai = new FakeAi(['请介绍你的订单服务。'])
    const engine = new ResumeInterviewEngine(ai, states, profile)
    const started = await engine.start(context, { sessionId: 'resume-1', targetRole: '后端开发工程师', jobDescription: '负责高并发 API，要求 PostgreSQL 和系统设计。', resumeContext: '做过订单服务' })
    expect(started.opening).toContain('后端开发工程师')
    expect(started.opening).toContain('自我介绍')
    expect(ai.calls).toHaveLength(0)
    expect(started.state.messages).toEqual([{ role: 'assistant', content: started.opening }])
    await states.save('resume-1', 'user-a', started.state)
    await engine.turn(context, 'resume-1', started.state, '我负责订单服务的接口开发。')
    const prompt = ai.calls[0]![0]!.content
    expect(prompt).toContain('后端开发工程师')
    expect(prompt).toContain('负责高并发 API')
    expect(prompt).toContain('做过订单服务')
    expect(ai.calls[0]!.at(-1)?.content).toBe('我负责订单服务的接口开发。')
    expect(await states.load('resume-1', 'user-a')).toMatchObject({ target_role: '后端开发工程师', job_description: '负责高并发 API，要求 PostgreSQL 和系统设计。' })
    states.close()
  })

  test('finishes reverse QA without another model call', async () => {
    const path = await databasePath()
    const states = new BunResumeInterviewStateRepository(path)
    states.initialize()
    const ai = new FakeAi([])
    const engine = new ResumeInterviewEngine(ai, states, profile)
    const state = {
      messages: [], phase: 'reverse_qa' as const, target_role: '后端', job_description: '', resume_context: '', questions_asked: [], phase_question_count: 2, is_finished: false, last_eval: {}, eval_history: [],
    }
    const result = await engine.turn(context, 'resume-end', state, '没有问题了，谢谢')
    expect(result).toEqual({ message: '', isFinished: true })
    expect(ai.calls).toHaveLength(0)
    expect((await states.load('resume-end', 'user-a'))?.is_finished).toBeTrue()
    states.close()
  })
})

describe('interview application service', () => {
  test.each(['', '🧑‍💻📝 分析结果：\n'])('validates structured JD preview with prefix %s and derives resume usage from actual context', async (prefix) => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi([prefix + JSON.stringify({
      company: '跨越速运',
      position: '高级 Java 工程师',
      role_summary: '负责物流核心系统开发',
      focus_areas: [{ area: 'Java', priority: '高', reason: 'JVM 调优和并发编程' }],
      prep_priorities: ['准备高并发案例'],
      likely_question_groups: [{ title: '系统设计', reason: '岗位要求', sample_questions: ['如何设计物流订单系统？'] }],
      question_blueprint: [{ category: '技术', focus_area: 'Java', intent: '验证原理', difficulty: 3 }],
      resume_alignment: {
        resume_used: true,
        fit_assessment: '没有可用简历',
        matching_evidence: [],
        risk_gaps: ['需要补充项目证据'],
        recommended_stories: [],
      },
    })])
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))

    const result = await service.previewJob(context, {
      jd_text: '负责物流核心系统设计开发，要求精通 Java、MySQL、Redis、消息队列、微服务和分布式系统，具备高并发项目经验。',
      use_resume: true,
    })
    sessions.close(); states.close()

    expect(result.preview).toMatchObject({
      role_summary: '负责物流核心系统开发',
      focus_areas: [{ area: 'Java', priority: '高', reason: 'JVM 调优和并发编程' }],
      prep_priorities: ['准备高并发案例'],
      likely_question_groups: [{ title: '系统设计', reason: '岗位要求', sample_questions: ['如何设计物流订单系统？'] }],
      resume_alignment: {
        resume_used: false, fit_assessment: '没有可用简历',
        matching_evidence: [], risk_gaps: ['需要补充项目证据'], recommended_stories: [],
      },
    })
  })

  test('starts resume sessions with durable state and metadata', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi(['欢迎，请做自我介绍。'])
    const dispatched: TaskRecord[] = []
    const tasks: PersistentTaskDispatcher = {
      async enqueue(input) { const task = { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending' as const, payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' }; dispatched.push(task); return task },
      async get() { return undefined },
    }
    const knowledgeStore: KnowledgeStore = {
      async loadTopics() { return {} }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {},
    }
    const deps: InterviewDependencies = {
      sessions, states, tasks, ids: { next: () => 'resume-2' }, ai,
      resume: { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '候选人做过订单服务' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } },
      knowledge: { async context() { return '' } }, knowledgeStore,
      settings: { async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }, async saveProvider() {}, async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {} },
      profile,
    }
    const service = new InterviewService(deps)
    const result = await service.start(context, { mode: 'resume', target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' })
    expect(result).toMatchObject({ session_id: 'resume-2', target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' })
    expect(await sessions.get('resume-2', 'user-a')).toMatchObject({ meta: { target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' } })
    expect(await states.load('resume-2', 'user-a')).toMatchObject({ resume_context: '候选人做过订单服务' })
    sessions.close(); states.close()
  })

  test('injects due reviews and semantic history into topic drill generation', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi([JSON.stringify([{ id: 1, question: '解释事件循环', difficulty: 3 }])])
    const profileRequests: unknown[][] = []
    const drillProfile: CandidateProfilePort = {
      async summary(...args) { profileRequests.push(args); expect(ai.calls).toHaveLength(0); return '本轮到期复习：微任务队列\n历史语义洞察：上次忽略了饿饿问题' },
      async targetRole() { return '' }, async updateTargetRole() {},
    }
    const deps = interviewDependencies({
      sessions, states, ai, candidateProfile: drillProfile,
      knowledgeStore: emptyKnowledgeStore({ typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } }),
    })
    deps.knowledge.context = async () => '事件循环与微任务队列'
    deps.knowledgeStore.readHighFrequency = async () => '任务调度顺序'
    const service = new InterviewService(deps)
    await service.start(context, { mode: 'topic_drill', topic: 'typescript', num_questions: 1 })
    expect(profileRequests).toEqual([['user-a', 'typescript', '专项训练：TypeScript\n本轮知识点：事件循环与微任务队列\n高频考点：任务调度顺序']])
    expect(ai.calls[0]![1]!.content).toContain('本轮到期复习：微任务队列')
    expect(ai.calls[0]![1]!.content).toContain('历史语义洞察：上次忽略了饿饿问题')
    sessions.close(); states.close()
  })

  test('retries an incomplete topic drill batch and sets a bounded output limit', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const completeQuestions = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, question: `事件循环问题 ${index + 1}`, difficulty: 3 }))
    const ai = new FakeAi([JSON.stringify(completeQuestions.slice(0, 1)), JSON.stringify(completeQuestions)])
    const service = new InterviewService(interviewDependencies({
      sessions, states, ai,
      knowledgeStore: emptyKnowledgeStore({ typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } }),
    }))

    const result = await service.start(context, { mode: 'topic_drill', topic: 'typescript', num_questions: 10 })
    if (result.mode !== 'topic_drill') throw new Error('Expected topic drill result')
    expect(result.questions).toHaveLength(10)
    expect(ai.calls).toHaveLength(2)
    expect(ai.options).toEqual([
      { maxTokens: 5120, jsonMode: true, reasoningEffort: 'low' },
      { maxTokens: 5120, jsonMode: true, reasoningEffort: 'low' },
    ])
    sessions.close(); states.close()
  })

  test('returns a readable 502 after repeated truncated topic drill JSON', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi(['[{"id":1', '[{"id":1'])
    const service = new InterviewService(interviewDependencies({
      sessions, states, ai,
      knowledgeStore: emptyKnowledgeStore({ typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } }),
    }))

    await expect(service.start(context, { mode: 'topic_drill', topic: 'typescript', num_questions: 10 })).rejects.toMatchObject({
      status: 502,
      code: 'provider_response_error',
      message: '模型返回的专项训练题目不完整，已自动重试，请稍后再试或更换模型。',
    })
    expect(ai.calls).toHaveLength(2)
    sessions.close(); states.close()
  })

  test('keeps sparse batch answers attached to their question for current and recovered review tasks', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const questions = [
      { id: 1, question: '第一题' },
      { id: 2, question: '第二题' },
      { id: 3, question: '第三题' },
    ]
    const evaluation = JSON.stringify({ scores: [{ question_id: 1, score: 8 }, { question_id: 3, score: 7 }], overall: { avg_score: 7.5, summary: '完成' } })
    const ai = new FakeAi([evaluation, evaluation])
    const dispatched: TaskRecord[] = []
    const service = new InterviewService(interviewDependencies({
      sessions, states, ai, tasks: taskDispatcher(dispatched),
      knowledgeStore: emptyKnowledgeStore({ typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } }),
    }))

    await sessions.create({ sessionId: 'batch-current', userId: 'user-a', mode: 'jd_prep', questions, meta: { preview: { position: '后端工程师' } } })
    const sparseAnswers = [{ question_id: 1, answer: '第一题答案' }, { question_id: 3, answer: '第三题答案' }]
    await service.end(context, 'batch-current', sparseAnswers)
    expect(dispatched[0]?.payload.answers_override).toEqual(sparseAnswers)
    await service.runReviewTask(dispatched[0]!)
    expect(ai.calls[0]![1]!.content).toContain('**题目**: 第二题\n**回答**: 未作答')
    expect(ai.calls[0]![1]!.content).toContain('**题目**: 第三题\n**回答**: 第三题答案')

    await sessions.create({ sessionId: 'batch-recovered', userId: 'user-a', mode: 'topic_drill', topic: 'typescript', questions })
    await sessions.saveAnswers('batch-recovered', 'user-a', sparseAnswers)
    await sessions.updateStatus('batch-recovered', 'user-a', 'reviewing')
    await service.runReviewTask({ task_id: 'batch-recovered', user_id: 'user-a', type: 'drill_review', status: 'running', payload: { session_id: 'batch-recovered' }, result: null, error: null, attempts: 1, created_at: '', updated_at: '' })
    expect(ai.calls[1]![1]!.content).toContain('**题目**: 第二题\n**回答**: 未作答')
    expect(ai.calls[1]![1]!.content).toContain('**题目**: 第三题\n**回答**: 第三题答案')
    sessions.close(); states.close()
  })

  test.each(['valid', 'invalid', 'missing'] as const)('persists streamed report before profile extraction (%s response)', async (insights) => {
    const path = await databasePath()
    const root = join(path, '..')
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const dimensions = { technical_depth: 8, project_articulation: 7, communication: 6.5, problem_solving: 7.5 }
    const extraction = { session_summary: '表现稳定', weak_points: [], strong_points: [], behavior_signals: [], topic_mastery: {}, avg_score: 7.3, dimension_scores: dimensions }
    const ai = new FakeAi(['# 简历面试复盘\n整体表现稳定。', ...(insights === 'invalid' ? [JSON.stringify({ ...extraction, avg_score: 99 })] : insights === 'missing' ? ['{}'] : []), JSON.stringify(extraction)])
    const tasks = taskDispatcher()
    const knowledgeStore = emptyKnowledgeStore()
    const resume = interviewDependencies({ sessions, states, ai }).resume
    const repository = new FileCandidateProfileRepository(root)
    const vectors = new BunKnowledgeVectorRepository(path); vectors.initialize()
    const embeddings = { async embed(_context: RequestContext, texts: readonly string[]) { return texts.map(() => Float32Array.from([1])) }, async signature() { return 'test' }, reset() {} }
    const candidateProfile = new ProfileService({ repository, sessions, tasks, ai, embeddings, vectors, resume, knowledgeStore })
    const service = new InterviewService(interviewDependencies({ sessions, states, ai, tasks, knowledgeStore, candidateProfile }))

    await sessions.create({ sessionId: 'resume-metrics', userId: 'user-a', mode: 'resume', meta: { target_role: '后端工程师' } })
    await states.save('resume-metrics', 'user-a', {
      messages: [{ role: 'assistant', content: '请介绍服务架构' }, { role: 'user', content: '我使用分层架构并做了压测' }],
      phase: 'reverse_qa', target_role: '后端工程师', job_description: '', resume_context: '负责过订单服务', questions_asked: ['请介绍服务架构'], phase_question_count: 2, is_finished: true,
      last_eval: { score: 7 }, eval_history: [{ phase: 'technical', score: 7, brief: '技术基础稳定' }],
    })
    await service.runReviewTask({ task_id: 'resume-metrics', user_id: 'user-a', type: 'resume_review', status: 'running', payload: { session_id: 'resume-metrics' }, result: null, error: null, attempts: 1, created_at: '', updated_at: '' })

    expect(ai.calls).toHaveLength(insights === 'valid' ? 2 : 3)
    expect(ai.calls[1]![1]!.content).toContain('dimension_scores')
    expect(ai.calls[0]![0]!.content).toContain('我使用分层架构并做了压测')
    expect(ai.options[1]?.jsonMode).toBeTrue()
    expect(await sessions.get('resume-metrics', 'user-a')).toMatchObject({ review: '# 简历面试复盘\n整体表现稳定。', meta: { profile_extract_failed: false }, overall: { avg_score: 7.3, dimension_scores: dimensions } })
    const savedProfile = await repository.load('user-a')
    expect(savedProfile.stats.score_history.at(-1)).toMatchObject({ mode: 'resume', avg_score: 7.3, dimension_scores: dimensions })
    expect(savedProfile.stats.dimension_scores).toEqual(dimensions)
    sessions.close(); states.close(); vectors.close()
  })

  test('does not publish a streamed report after its task loses ownership during generation', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const controller = new AbortController()
    let release!: (text: string) => void
    let entered!: () => void
    const pending = new Promise<string>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const ai: TextGenerationUseCases = { async complete() { throw new Error('unexpected complete') }, async *stream() { entered(); yield await pending } }
    let profileWrites = 0
    const service = new InterviewService(interviewDependencies({ sessions, states, ai, candidateProfile: {
      ...profile, async reviewExtractionPrompt() { return '提取结构化洞察。' }, async afterReview() { profileWrites++; return {} },
    } }))
    try {
      await sessions.create({ sessionId: 'cancelled', userId: 'user-a', mode: 'resume' })
      await states.save('cancelled', 'user-a', { messages: [], eval_history: [], phase: 'technical', phase_question_count: 0, resume_context: '合成简历', target_role: '后端', job_description: '', questions_asked: [], is_finished: false, last_eval: {} })
      const result = service.runReviewTask({ task_id: 'cancelled', user_id: 'user-a', type: 'resume_review', status: 'running', payload: {}, result: null, error: null, attempts: 1, created_at: '', updated_at: '', signal: controller.signal }).catch(error => error)
      await started
      controller.abort(new Error('lease lost'))
      release('# 已失效的报告')
      expect(await result).toMatchObject({ message: 'lease lost' })
      expect((await sessions.get('cancelled', 'user-a'))?.review).toBeNull()
      expect(profileWrites).toBe(0)
    } finally { release(''); sessions.close(); states.close() }
  })
})


describe('job preparation saved lifecycle', () => {
  const input = { jd_text: '合成岗位要求 TypeScript、数据库、分布式系统设计、缓存、异步执行和清晰的技术表达能力。'.repeat(2), company: '示例公司', position: '后端工程师', use_resume: false, request_id: 'b9c47adb-1fd3-4376-b366-b3b777208be8' }
  const preview = JSON.stringify({ company: '示例公司', position: '后端工程师', role_summary: '后端工程师', focus_areas: [], likely_question_groups: [], resume_alignment: { resume_used: false, fit_assessment: '未启用简历', matching_evidence: [], risk_gaps: [], recommended_stories: [] }, prep_priorities: [], question_blueprint: [] })
  const questions = JSON.stringify({ questions: Array.from({ length: 4 }, (_, i) => ({ id: i + 1, question: `合成问题 ${i + 1}` })) })
  async function setup(replies: string[] = []) {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi(replies)
    const deps = interviewDependencies({ sessions, states, ai })
    let serial = 0
    deps.ids = { next: () => `job-${++serial}` }
    return { path, sessions, states, ai, deps, service: new InterviewService(deps) }
  }

  test('persists analysis before practice; restores after reopen and retries without model calls', async () => {
    const h = await setup([preview, questions])
    const first = await h.service.previewJob(context, input)
    expect((await h.service.history(context, {})).items).toMatchObject([{ session_id: first.session_id, status: 'prepared' }])
    expect((await h.service.resume(context, first.session_id)).meta).toMatchObject({ jd_text: input.jd_text, use_resume: false, preview: first.preview })
    expect(await h.service.previewJob(context, input)).toEqual(first)
    expect(h.ai.calls).toHaveLength(1)
    await expect(h.service.end(context, first.session_id, [])).rejects.toThrow('请先开始训练')
    h.sessions.close()
    const reopened = new BunInterviewSessionRepository(h.path); reopened.initialize()
    const service = new InterviewService({ ...h.deps, sessions: reopened })
    expect(await service.previewJob(context, input)).toEqual(first)
    const started = await service.startJob(context, { ...input, session_id: first.session_id, jd_text: 'tampered', preview_data: { role_summary: 'tampered' } })
    expect(started.session_id).toBe(first.session_id)
    expect(started.meta.jd_text).toBe(input.jd_text)
    expect(started.preview).toEqual(first.preview)
    expect((await service.history(context, {})).items).toMatchObject([{ session_id: first.session_id, status: 'ongoing' }])
    expect(await service.startJob(context, { ...input, session_id: first.session_id })).toEqual(started)
    expect(h.ai.calls).toHaveLength(2)
    await reopened.updateMeta(first.session_id, 'user-a', { profile_extract_failed: false })
    expect(await service.startJob(context, { ...input, session_id: first.session_id })).toEqual(started)
    await service.draft(context, first.session_id, [{ question_id: 1, answer: '已保存的回答' }])
    expect((await service.resume(context, first.session_id)).transcript.slice(0, 2)).toMatchObject([{ role: 'assistant' }, { role: 'user', content: '已保存的回答' }])
    expect(await service.history({ ...context, userId: 'user-b' }, {})).toEqual({ items: [], total: 0 })
    await expect(service.startJob({ ...context, userId: 'user-b' }, { ...input, session_id: first.session_id })).rejects.toThrow('备面记录不存在')
    await service.delete(context, first.session_id)
    await expect(service.previewJob(context, input)).rejects.toThrow('已删除')
    expect(h.ai.calls).toHaveLength(2)
    reopened.close(); h.states.close()
  })

  test('retains the saved plan when question generation fails and preserves previous plans on reanalysis', async () => {
    const h = await setup([preview, '{"questions":[]}', questions, preview])
    const first = await h.service.previewJob(context, input)
    await expect(h.service.startJob(context, { ...input, session_id: first.session_id })).rejects.toThrow('数量不足')
    expect((await h.service.resume(context, first.session_id)).status).toBe('prepared')
    await h.service.startJob(context, { ...input, session_id: first.session_id })
    await expect(h.service.previewJob(context, { ...input, position: '不同岗位' })).rejects.toThrow('已改变')
    const next = await h.service.previewJob(context, { ...input, request_id: crypto.randomUUID(), position: '不同岗位' })
    expect(next.session_id).not.toBe(first.session_id)
    expect((await h.service.history(context, {})).total).toBe(2)
    h.sessions.close(); h.states.close()
  })

  test('serializes concurrent submissions across repository instances and completes after caller disconnects', async () => {
    const h = await setup()
    let release!: (value: string) => void
    let called!: () => void
    const entered = new Promise<void>((resolve) => { called = resolve })
    const pending = new Promise<string>((resolve) => { release = resolve })
    let signal: AbortSignal | undefined
    h.deps.ai = { async complete(ctx) { signal = ctx.signal; called(); return pending }, async *stream() {} }
    const service = new InterviewService(h.deps)
    const abort = new AbortController()
    const first = service.previewJob({ ...context, signal: abort.signal }, input)
    await entered
    const otherRepo = new BunInterviewSessionRepository(h.path); otherRepo.initialize()
    const otherService = new InterviewService({ ...h.deps, sessions: otherRepo })
    await expect(otherService.previewJob(context, input)).rejects.toThrow('正在生成')
    abort.abort()
    expect(signal?.aborted).toBe(false)
    release(preview)
    const result = await first
    expect(await otherService.previewJob(context, input)).toEqual(result)
    expect((await otherService.history(context, {})).total).toBe(1)
    otherRepo.close(); h.sessions.close(); h.states.close()
  })

  test('does not recreate a plan deleted while questions are being generated', async () => {
    const h = await setup([preview])
    const plan = await h.service.previewJob(context, input)
    let release!: (value: string) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    h.deps.ai = { async complete() { entered(); return new Promise<string>((resolve) => { release = resolve }) }, async *stream() {} }
    const service = new InterviewService(h.deps)
    const pending = service.startJob(context, { ...input, session_id: plan.session_id })
    await started
    await service.delete(context, plan.session_id)
    release(questions)
    await expect(pending).rejects.toThrow('变更或删除')
    expect(await service.history(context, {})).toEqual({ items: [], total: 0 })
    h.sessions.close(); h.states.close()
  })

  for (const operation of ['preview', 'start'] as const) test(`reports deletion after ${operation} commits as 404, not a TypeError`, async () => {
    const h = await setup([preview, questions])
    const plan = operation === 'start' ? await h.service.previewJob(context, input) : undefined
    const complete = h.sessions.completeJobPrep.bind(h.sessions)
    h.sessions.completeJobPrep = async (value) => {
      const saved = await complete(value)
      if (saved) await h.sessions.delete(value.sessionId, value.userId)
      return saved
    }
    const run = () => operation === 'preview'
      ? h.service.previewJob(context, input)
      : h.service.startJob(context, { ...input, session_id: plan!.session_id })
    await expect(run()).rejects.toMatchObject({ status: 404 })
    await expect(run()).rejects.toMatchObject({ status: 404 })
    expect(h.ai.calls).toHaveLength(operation === 'preview' ? 1 : 2)
    h.sessions.close(); h.states.close()
  })

  test('requires a stable direct-start request and replays its result after repository reopen', async () => {
    const h = await setup([questions])
    const direct = { ...input, preview_data: JSON.parse(preview) }
    await expect(h.service.startJob(context, { ...direct, request_id: undefined })).rejects.toMatchObject({ status: 400 })
    expect(h.ai.calls).toHaveLength(0)
    const first = await h.service.startJob(context, direct)
    h.sessions.close()
    const reopened = new BunInterviewSessionRepository(h.path); reopened.initialize()
    const service = new InterviewService({ ...h.deps, sessions: reopened })
    expect(await service.startJob(context, direct)).toEqual(first)
    expect((await service.history(context, {})).total).toBe(1)
    expect(h.ai.calls).toHaveLength(1)
    reopened.close(); h.states.close()
  })

  test('recovers an expired generation lease and fences its previous owner', async () => {
    const h = await setup()
    const { Database } = await import('bun:sqlite')
    const claim = { userId: 'user-a', key: 'preview:lease', fingerprint: 'same-input', owner: 'old-worker' }
    expect(await h.sessions.claimJobPrep(claim)).toEqual({ state: 'claimed' })
    const db = new Database(h.path)
    db.query('UPDATE job_prep_operations SET updated_at = 0').run()
    expect(await h.sessions.claimJobPrep({ ...claim, owner: 'new-worker' })).toEqual({ state: 'claimed' })
    const result = { userId: 'user-a', key: claim.key, sessionId: 'recovered', meta: {}, questions: [], existing: false }
    expect(await h.sessions.completeJobPrep({ ...result, owner: 'old-worker' })).toBeFalse()
    await h.sessions.releaseJobPrep('user-a', claim.key, 'old-worker')
    expect(await h.sessions.completeJobPrep({ ...result, owner: 'new-worker' })).toBeTrue()
    db.close(); h.sessions.close(); h.states.close()
  })

  test('includes legacy JD sessions with questions and no answers, but still hides empty stubs', async () => {
    const h = await setup()
    await h.sessions.create({ sessionId: 'legacy', userId: 'user-a', mode: 'jd_prep', questions: [{ id: 1, question: '已生成题目' }] })
    await h.sessions.create({ sessionId: 'empty', userId: 'user-a', mode: 'jd_prep' })
    expect((await h.service.history(context, {})).items.map((item) => item.session_id)).toEqual(['legacy'])
    h.sessions.close(); h.states.close()
  })
})

test('retries Copilot snapshots using copilot_review and exposes their history and task type', async () => {
  const path = await databasePath()
  const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
  const states = new BunResumeInterviewStateRepository(path); states.initialize()
  const dispatched: TaskRecord[] = []
  const service = new InterviewService(interviewDependencies({ sessions, states, ai: new FakeAi([]), tasks: taskDispatcher(dispatched) }))
  try {
    await sessions.create({ sessionId: 'copilot-retry', userId: 'user-a', mode: 'copilot', meta: { source_transcript: '面试官: 问题\n候选人: 回答', recording_mode: 'dual' } })
    await sessions.updateStatus('copilot-retry', 'user-a', 'review_failed')
    await service.generateReview(context, 'copilot-retry')
    expect(dispatched).toMatchObject([{ type: 'copilot_review', task_id: 'copilot-retry' }])
    expect(await service.task(context, 'copilot-retry')).toMatchObject({ type: 'copilot_review', status: 'pending' })
    expect(await service.history(context, { mode: 'copilot' })).toMatchObject({ total: 1, items: [{ mode: 'copilot' }] })
  } finally { sessions.close(); states.close() }
})


describe('personal interview training loop', () => {
  test('freezes selected materials and mode while respecting explicit resume opt-out', async () => {
    const path = await databasePath(); const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi(['继续说说项目职责。'])
    let material = '项目证据版本一'
    const deps = interviewDependencies({ sessions, states, ai })
    deps.resume.text = async () => '不应使用的默认简历'
    deps.materials = { async documentText(_ctx, ids) { return ids.map((id) => ({ document_id: id, filename: id + '.md', content: material, updated_at: 'revision-1' })) } }
    const service = new InterviewService(deps)
    try {
      const started = await service.start(context, { mode: 'resume', target_role: '后端', use_resume: false, training_mode: 'coach', material_document_ids: ['project'] })
      material = '项目证据版本二'
      await service.chat(context, started.session_id, '我来介绍本人职责。')
      const state = await states.load(started.session_id, 'user-a')
      expect(state?.resume_context).toContain('项目证据版本一')
      expect(state?.resume_context).not.toContain('不应使用的默认简历')
      expect(state?.resume_context).not.toContain('版本二')
      expect(ai.calls[0]?.[0]?.content).toContain('教练练习')
      expect((await service.resume(context, started.session_id)).meta).toMatchObject({ training_mode: 'coach', selected_materials: [{ document_id: 'project', revision: 'revision-1' }] })
    } finally { sessions.close(); states.close() }
  })

  test('makes a partial report visible and reuses the saved report after profile synchronization fails', async () => {
    const path = await databasePath(); const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const gate = Promise.withResolvers<void>(); const visible = Promise.withResolvers<void>()
    let streams = 0; let profileCalls = 0
    const ai: TextGenerationUseCases = { async complete() { throw new Error('unexpected complete') }, async *stream() { streams++; yield '# 报告首段'; visible.resolve(); await gate.promise; yield '\n完整正文' } }
    const service = new InterviewService(interviewDependencies({ sessions, states, ai, candidateProfile: { ...profile, async afterReview() { profileCalls++; if (profileCalls === 1) throw new Error('temporary projection failure'); return {} } } }))
    try {
      const started = await service.start(context, { mode: 'resume', target_role: '后端' })
      await service.end(context, started.session_id, [])
      const task = { task_id: started.session_id, user_id: 'user-a', type: 'resume_review', status: 'running' as const, payload: {}, attempts: 1, created_at: '', updated_at: '' }
      const running = service.runReviewTask(task)
      await visible.promise
      expect((await service.review(context, started.session_id)).review).toBe('# 报告首段')
      expect((await service.review(context, started.session_id)).status).toBe('reviewing')
      gate.resolve(); await running
      expect((await service.review(context, started.session_id)).meta.profile_extract_failed).toBeTrue()
      const reopened = new InterviewService(interviewDependencies({ sessions, states, ai, candidateProfile: { ...profile, async afterReview() { profileCalls++; return {} } } }))
      await reopened.runReviewTask(task)
      expect(streams).toBe(1); expect(profileCalls).toBe(2)
      expect((await reopened.review(context, started.session_id)).meta.review_stage).toBe('complete')
    } finally { gate.resolve(); sessions.close(); states.close() }
  })

  test('preserves original answers, persists evidence-bound comparisons and replays the same request', async () => {
    const path = await databasePath(); const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi([JSON.stringify({ comparison: '补充了事务边界，验证证据还不足。', technical_gaps: [{ point: '缺少并发验证', evidence: '尚未压测', exercise: '写一个并发重复请求用例' }], expression_gaps: [] })])
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))
    try {
      await sessions.create({ sessionId: 'practice', userId: 'user-a', mode: 'resume' })
      await sessions.appendMessage('practice', 'user-a', 'assistant', '怎么保证幂等？')
      await sessions.appendMessage('practice', 'user-a', 'user', '使用唯一约束。')
      await sessions.saveReview({ sessionId: 'practice', userId: 'user-a', review: '原始报告' })
      await sessions.saveReferenceAnswer('practice', 'user-a', 'resume-turn-1', '参考：唯一键配合事务与并发验证。')
      const requestId = crypto.randomUUID()
      const pendingComparison = service.compareAnswer(context, 'practice', 'resume-turn-1', '唯一约束和事务，尚未压测', requestId)
      await expect(service.compareAnswer(context, 'practice', 'resume-turn-1', '另一份回答', crypto.randomUUID())).rejects.toMatchObject({ status: 409 })
      const first = await pendingComparison
      const replay = await new InterviewService(interviewDependencies({ sessions, states, ai })).compareAnswer(context, 'practice', 'resume-turn-1', '唯一约束和事务，尚未压测', requestId)
      expect(replay).toEqual(first); expect(ai.calls).toHaveLength(1)
      expect(ai.calls[0]?.find((message) => message.role === 'user')?.content.toLowerCase()).toContain('json')
      expect((await sessions.get('practice', 'user-a'))?.transcript[1]?.content).toBe('使用唯一约束。')
      expect((await service.trainingProgress(context)).items[0]?.technical_gaps[0]?.evidence).toBe('尚未压测')
      expect((await service.trainingProgress({ ...context, userId: 'user-b' })).items).toEqual([])
      await expect(service.compareAnswer({ ...context, userId: 'user-b' }, 'practice', 'resume-turn-1', 'x', crypto.randomUUID())).rejects.toMatchObject({ status: 404 })
      await expect(service.compareAnswer(context, 'practice', 'resume-turn-1', '更改内容', requestId)).rejects.toMatchObject({ status: 409 })
    } finally { sessions.close(); states.close() }
  })
  test('rejects invented comparison evidence without saving a training attempt', async () => {
    const path = await databasePath(); const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi([JSON.stringify({ comparison: '无依据的判断', technical_gaps: [{ point: '缺口', evidence: '不存在的候选人原话', exercise: '练习' }], expression_gaps: [] })])
    const service = new InterviewService(interviewDependencies({ sessions, states, ai }))
    try {
      await sessions.create({ sessionId: 'unsupported-evidence', userId: 'user-a', mode: 'resume' })
      await sessions.appendMessage('unsupported-evidence', 'user-a', 'assistant', '如何验证？')
      await sessions.appendMessage('unsupported-evidence', 'user-a', 'user', '使用测试。')
      await sessions.saveReview({ sessionId: 'unsupported-evidence', userId: 'user-a', review: '原始报告' })
      await sessions.saveReferenceAnswer('unsupported-evidence', 'user-a', 'resume-turn-1', '补充边界测试。')
      await expect(service.compareAnswer(context, 'unsupported-evidence', 'resume-turn-1', '我补充边界测试。', crypto.randomUUID())).rejects.toThrow('evidence must quote')
      expect((await service.trainingProgress(context)).items).toEqual([])
    } finally { sessions.close(); states.close() }
  })
})

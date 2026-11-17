import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { generate } from './gateway.ts';
import type { Generate } from './gateway.ts';
import { InputError, object, text } from './model.ts';
import type { ChatMessage, Job, JobInput, Material, Session, Topic, Settings, ModelProfile } from './model.ts';
import { knowledgeMessages, messages, validateCitations } from './prompts.ts';

type JobRequest = Pick<Job, 'sessionId' | 'requestId' | 'input' | 'fingerprint'> & { previous?: Job };
type GenerationPlan = {
  messages: () => ChatMessage[];
  save: (output: string, job: Job) => void;
  maxLength: number;
};

export class PracticeService {
  store: Store;
  private call: Generate;
  controllers = new Map<string, AbortController>();
  pending = new Set<Promise<void>>();
  closing = false;
  constructor(store: Store, call: Generate = generate) { this.store = store; this.call = call; store.interrupt(); }
  private profileInfo(): { profileId?: string; profileName?: string } {
    const selected = this.store.get<{ profileId: string }>('meta', 'model-selection');
    const profile = selected ? this.store.get<ModelProfile>('profiles', selected.profileId) : undefined;
    return profile ? { profileId: profile.id, profileName: profile.name } : {};
  }
  material(input: unknown, id?: string): Material {
    const body = object(input), current = id ? this.store.require<Material>('materials', id) : undefined;
    if (!['resume', 'project', 'jd', 'notes'].includes(String(body.kind))) throw new InputError('资料类型无效');
    const value: Material = { id: current?.id ?? randomUUID(), title: text(body.title, '标题', 160).trim(),
      kind: body.kind as Material['kind'], text: text(body.text, '正文'), revision: (current?.revision ?? 0) + 1,
      createdAt: current?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    const topicId = body.topicId === undefined ? current?.topicId : text(body.topicId, '领域 ID', 100, true);
    if (value.kind === 'notes' && topicId) {
      this.store.require('topics', topicId);
      const section = body.knowledgeSection ?? current?.knowledgeSection ?? 'core';
      if (!['core', 'questions'].includes(String(section))) throw new InputError('知识分类无效');
      value.topicId = topicId; value.knowledgeSection = section as Material['knowledgeSection'];
    }
    this.store.saveMaterial(value, current ? Number(body.revision) : undefined);
    return value;
  }
  create(input: unknown): Session {
    const body = object(input);
    if (!['strict', 'coach'].includes(String(body.mode))) throw new InputError('面试模式无效');
    if (!Array.isArray(body.materialIds) || body.materialIds.length > 8 || new Set(body.materialIds).size !== body.materialIds.length)
      throw new InputError('请选择最多 8 份资料');
    const materials = body.materialIds.map(id => this.store.require<Material>('materials', text(id, '资料 ID', 100)));
    let topic: Topic | undefined;
    if (body.trainingKind !== undefined && !['interview', 'topic'].includes(String(body.trainingKind))) throw new InputError('训练类型无效');
    if (body.trainingKind === 'topic' || body.topicId) {
      topic = this.store.require<Topic>('topics', text(body.topicId, '训练领域', 100));
      const available = this.store.list<Material>('materials').filter(item => item.kind === 'notes' && item.topicId === topic!.id);
      if (body.knowledgeIds !== undefined && (!Array.isArray(body.knowledgeIds) || body.knowledgeIds.length > 500 || new Set(body.knowledgeIds).size !== body.knowledgeIds.length)) throw new InputError('知识文件选择无效');
      const selected = body.knowledgeIds as unknown[] | undefined;
      if (selected?.some(id => !available.some(item => item.id === id))) throw new InputError('所选知识不属于当前训练领域');
      const notes = available.filter(item => !selected || selected.includes(item.id));
      for (const section of ['core', 'questions'] as const) {
        const entries = notes.filter(item => (item.knowledgeSection ?? 'core') === section && !materials.some(chosen => chosen.id === item.id));
        if (!entries.length) continue;
        materials.push({ id: `topic-${topic.id}-${section}`, title: `${topic.name} · ${section === 'core' ? '核心知识' : '高频题库'}`, kind: 'notes', topicId: topic.id, knowledgeSection: section,
          text: entries.map(item => `## ${item.title} / v${item.revision}\n${item.text}`).join('\n\n'), revision: topic.revision, createdAt: topic.createdAt, updatedAt: topic.updatedAt });
      }
    }
    if (materials.length > 8) throw new InputError('领域知识合并后仍超过 8 份，请减少补充资料');
    for (const kind of ['resume', 'jd']) if (materials.filter(item => item.kind === kind).length > 1)
      throw new InputError(kind === 'resume' ? '本轮只选一份简历，避免混用不同版本' : '本轮只选一份 JD，避免混用不同岗位');
    if (materials.reduce((sum, item) => sum + item.text.length, 0) > 60000) throw new InputError('本轮资料合计不能超过 60000 字符');
    const value: Session = { id: randomUUID(), title: text(body.title, '练习名称', 160).trim(), role: text(body.role, '目标岗位', 200),
      focus: body.focus === undefined ? '' : text(body.focus, '专项重点', 200, true).trim(),
      mode: body.mode as Session['mode'], status: 'active', materials, turns: [], revision: 1,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    value.trainingKind = topic ? 'topic' : 'interview';
    if (topic) { value.topicId = topic.id; value.topicName = topic.name; if (!value.focus) value.focus = topic.name; }
    this.store.put('sessions', value); return value;
  }
  answer(sessionId: string, input: unknown): Session {
    const body = object(input), session = this.store.require<Session>('sessions', sessionId);
    if (session.status !== 'active') throw new InputError('本轮已结束，原回答保持不变；可以练习重答', 409);
    if (this.store.running(sessionId)) throw new InputError('请等待当前生成完成或先取消', 409);
    if (body.revision !== session.revision) throw new InputError('本轮已更新，草稿仍保留；请刷新后重试', 409);
    const turn = session.turns.at(-1);
    if (!turn || turn.id !== body.turnId || turn.answer !== undefined) throw new InputError('当前问题不可重复作答', 409);
    turn.answer = text(body.answer, '回答', 20000);
    this.store.saveSession(session); return session;
  }
  complete(sessionId: string): Session {
    const session = this.store.require<Session>('sessions', sessionId);
    if (this.store.running(sessionId)) throw new InputError('请等待当前生成完成或先取消', 409);
    if (!session.turns.some(turn => turn.answer !== undefined)) throw new InputError('至少完成一道题后结束面试');
    if (session.status === 'completed') return session;
    session.status = 'completed'; this.store.saveSession(session); return session;
  }
  job(sessionId: string, input: unknown): Job {
    if (this.closing) throw new InputError('服务正在退出，请稍后重试', 503);
    const body = object(input), session = this.store.require<Session>('sessions', sessionId);
    const requestId = text(body.requestId, '请求标识', 100);
    if (!['prepare', 'next', 'reference', 'review', 'compare'].includes(String(body.kind))) throw new InputError('生成任务无效');
    const task: JobInput = { kind: body.kind as JobInput['kind'] };
    if (body.turnId !== undefined) task.turnId = text(body.turnId, '问题 ID', 100);
    if (task.kind === 'compare') task.answer = text(body.answer, '重答', 20000);
    const request = this.jobRequest(sessionId, requestId, task);
    if (request.previous && ['running', 'succeeded'].includes(request.previous.status)) return request.previous;
    const turn = session.turns.find(item => item.id === task.turnId);
    if (task.kind === 'next' && (session.status !== 'active' || session.turns.some(item => item.answer === undefined)))
      throw new InputError('先回答当前问题；已结束的面试请新建一轮', 409);
    if (task.kind === 'next' && session.turns.length >= 30) throw new InputError('本轮已完成 30 题，请结束复盘后开启新一轮');
    if (['reference', 'compare'].includes(task.kind) && !turn) throw new InputError('问题不存在', 404);
    if (['reference', 'compare'].includes(task.kind) && session.mode === 'strict' && session.status === 'active')
      throw new InputError('严格模拟结束后再查看参考答法与练习重答', 409);
    if (task.kind === 'compare' && !turn?.reference) throw new InputError('先生成本题参考答法，再练习重答');
    if (task.kind === 'compare' && turn?.answer === undefined) throw new InputError('请先保存原回答，再进行重答比较');
    if (task.kind === 'review' && session.status !== 'completed') throw new InputError('请先结束本轮面试');
    if (task.kind === 'prepare' && (session.turns.length > 0 || session.status !== 'active')) throw new InputError('备面分析只在开始答题前生成，避免影响严格模拟');
    const snapshot = structuredClone(session);
    return this.startJob(request, {
      messages: () => messages(snapshot, task),
      maxLength: 160000,
      save: (output, job) => {
        validateCitations(output, snapshot);
        const session = this.store.require<Session>('sessions', job.sessionId);
        if (session.revision !== snapshot.revision) throw new Error('会话版本已变化，未写入过期结果');
        const turn = session.turns.find(item => item.id === task.turnId);
        if (task.kind === 'prepare') session.preparation = output;
        else if (task.kind === 'next') session.turns.push({ id: randomUUID(), question: output.trim(), attempts: [] });
        else if (task.kind === 'reference' && turn) turn.reference = output;
        else if (task.kind === 'review') session.review = output;
        else if (task.kind === 'compare' && turn) turn.attempts.push({ id: job.id, text: task.answer!, comparison: output, createdAt: new Date().toISOString() });
        else throw new Error('任务对应问题已不存在');
        this.store.saveSession(session);
      },
    });
  }
  cancel(jobId: string): Job {
    const job = this.store.require<Job>('jobs', jobId);
    if (job.status === 'running') this.controllers.get(jobId)?.abort();
    return job;
  }
  knowledgeJob(topicId: string, input: unknown): Job {
    if (this.closing) throw new InputError('服务正在退出，请稍后重试', 503);
    const topic = this.store.require<Topic>('topics', topicId), body = object(input);
    if (!['core', 'questions'].includes(String(body.section))) throw new InputError('请选择核心知识或高频题库');
    const requestId = text(body.requestId, '请求标识', 100), sessionId = `knowledge:${topicId}`;
    const task: JobInput = { kind: 'knowledge', section: body.section as 'core' | 'questions' };
    const request = this.jobRequest(sessionId, requestId, task);
    if (request.previous && ['running', 'succeeded'].includes(request.previous.status)) return request.previous;
    const section = body.section as 'core' | 'questions';
    return this.startJob(request, {
      messages: () => knowledgeMessages(topic, section, this.store.list<Material>('materials')),
      maxLength: 59000,
      save: (output, job) => {
        if (this.store.require<Topic>('topics', topic.id).revision !== topic.revision) throw new Error('领域已修改，未写入旧版本生成内容；可重新生成');
        const now = new Date().toISOString();
        const material: Material = { id: randomUUID(), title: `${topic.name} · AI ${section === 'questions' ? '高频题库' : '核心知识'}补充`, kind: 'notes', topicId: topic.id, knowledgeSection: section,
          text: output, revision: 1, createdAt: now, updatedAt: now };
        this.store.put('materials', material); job.materialId = material.id;
      },
    });
  }
  private jobRequest(sessionId: string, requestId: string, input: JobInput): JobRequest {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.store.list<Job>('jobs').find(job => job.sessionId === sessionId && job.requestId === requestId);
    if (previous && previous.fingerprint !== fingerprint) throw new InputError('同一请求标识不能用于不同内容', 409);
    // Replay before checking current business state: a successful request may have advanced the session.
    return { sessionId, requestId, input, fingerprint, previous };
  }
  private startJob(request: JobRequest, plan: GenerationPlan): Job {
    const knowledge = request.input.kind === 'knowledge';
    if (this.store.running(request.sessionId)) throw new InputError(knowledge ? '该领域已有生成任务，请等待或先取消' : '本轮已有生成任务，请等待或取消', 409);
    const settings = this.store.settings();
    if (!settings.apiKey && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(settings.baseUrl)) throw new InputError('请先在模型设置中填写 API Key；支持自定义网关');
    const now = new Date().toISOString(), { previous, ...identity } = request;
    const job: Job = { ...identity, id: previous?.id ?? randomUUID(), status: 'running', draft: '', attempt: (previous?.attempt ?? 0) + 1,
      createdAt: previous?.createdAt ?? now, updatedAt: now, model: settings.model, effort: settings.effort, ...this.profileInfo() };
    this.store.put('jobs', job);
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    const operation = this.run(job, controller, settings, plan);
    this.pending.add(operation); void operation.finally(() => this.pending.delete(operation));
    return this.store.require<Job>('jobs', job.id);
  }
  private async run(job: Job, controller: AbortController, settings: Settings, plan: GenerationPlan): Promise<void> {
    const started = performance.now(); let lastSaved = started;
    const persist = (value = job) => { value.updatedAt = new Date().toISOString(); this.store.put('jobs', value); };
    try {
      const output = await this.call(settings, plan.messages(), controller.signal, draft => {
        if (controller.signal.aborted) return;
        if (job.firstTokenMs === undefined && draft) job.firstTokenMs = Math.round(performance.now() - started);
        job.draft = draft; if (performance.now() - lastSaved > 300) { persist(); lastSaved = performance.now(); }
      });
      if (controller.signal.aborted) throw new Error('生成已取消');
      if (!output.trim() || output.length > plan.maxLength) throw new Error('模型返回空结果或内容过长');
      // Keep completion metadata separate so a rollback cannot leak a nonexistent material ID into the failed job.
      this.store.transaction(() => {
        const completed: Job = { ...job, draft: output, status: 'succeeded', elapsedMs: Math.round(performance.now() - started) };
        plan.save(output, completed);
        persist(completed);
      });
    } catch (error) {
      job.status = controller.signal.aborted ? (this.closing ? 'interrupted' : 'cancelled') : 'failed';
      job.error = controller.signal.aborted
        ? (job.input.kind === 'knowledge' ? '任务已中止，原知识内容保留，可手动重试' : this.closing ? '应用退出，未完成任务可手动重试' : '已取消，原回答保持不变')
        : safeError(error, settings.apiKey);
      job.elapsedMs = Math.round(performance.now() - started); persist();
    } finally { this.controllers.delete(job.id); }
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.all(this.pending);
  }
}
function safeError(error: unknown, key: string): string {
  let value = error instanceof Error ? error.message : '生成失败';
  if (key) value = value.replaceAll(key, '[已隐藏]');
  if (/timeout|timed out/i.test(value)) return '模型生成超时，已保存片段；请检查网关速度或调整超时后重试';
  return value.slice(0, 600);
}

import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { assertContextActive, type RequestContext } from '../kernel/context.ts'

export const EVIDENCE_KINDS = ['current_source', 'personal_reproduction', 'historical_record', 'user_reported_history', 'reference_material', 'test_definition', 'practice_card', 'interview_draft'] as const
export type EvidenceKind = typeof EVIDENCE_KINDS[number]
export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  current_source: '当前源码；不证明历史职责或运行结果', personal_reproduction: '后续个人复现；不等于原实习实现',
  historical_record: '历史记录；只支持记录范围内的事实', user_reported_history: '本人历史自述；未核验原始产物',
  reference_material: '参考材料；不代表本人做过', test_definition: '测试定义；不等于本轮实际通过',
  practice_card: '学习题卡；待补充项不是已确认事实', interview_draft: '面试草稿；具体经历仍需核对',
}
export type EvidenceSource = { source_id: string; path: string; kind: EvidenceKind; sha256: string; revision: string; start_line: number; topics: string[]; notes: string; content: string }
export type EvidenceProjectInput = { project_id: string; name: string; aliases: string[]; sources: EvidenceSource[] }
export type EvidenceProject = EvidenceProjectInput & { version: string; imported_at: string }
export type EvidenceSelection = { project_id: string; name: string; version: string }
export type EvidenceProjectSummary = EvidenceSelection & { aliases: string[]; source_count: number; imported_at: string }
export type EvidenceHit = { citation_id: string; project_id: string; project_name: string; version: string; source_id: string; path: string; kind: EvidenceKind; kind_label: string; sha256: string; revision: string; start_line: number; end_line: number; text: string; notes: string }
export interface ProjectEvidenceStore {
  list(userId: string): Promise<EvidenceProjectSummary[]>
  read(userId: string, projectId: string, version?: string): Promise<EvidenceProject | undefined>
  save(userId: string, project: EvidenceProject): Promise<void>
}
function account(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
export function validateEvidenceProject(project: EvidenceProjectInput): void {
  const fail = () => { throw new AppError('项目证据格式无效，或超出数量/大小限制。', 400) }
  if (!project || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project.project_id) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 160 || !Array.isArray(project.aliases) || project.aliases.length > 20 || project.aliases.some(value => typeof value !== 'string' || !value.trim() || value.length > 100) || !Array.isArray(project.sources) || !project.sources.length || project.sources.length > 80) fail()
  const ids = new Set<string>()
  for (const source of project.sources) {
    if (!source || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(source.source_id) || ids.has(source.source_id) || typeof source.path !== 'string' || !source.path || source.path.length > 400 || /[\\:\x00-\x1f]/.test(source.path) || source.path.startsWith('/') || source.path.split('/').some(part => !part || part === '.' || part === '..') || !EVIDENCE_KINDS.includes(source.kind) || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.revision !== 'string' || source.revision.length > 160 || !Number.isInteger(source.start_line) || source.start_line < 1 || typeof source.notes !== 'string' || source.notes.length > 2000 || typeof source.content !== 'string' || !source.content.trim() || source.content.length > 60000 || !Array.isArray(source.topics) || source.topics.length > 20 || source.topics.some(value => typeof value !== 'string' || value.length > 100)) fail()
    ids.add(source.source_id)
  }
  if (new TextEncoder().encode(JSON.stringify(project)).length > 1_500_000) fail()
}
function summary(project: EvidenceProject): EvidenceProjectSummary {
  return { project_id: project.project_id, name: project.name, version: project.version, aliases: project.aliases, source_count: project.sources.length, imported_at: project.imported_at }
}
function terms(text: string): string[] {
  const lower = text.toLowerCase()
  const chinese = [...lower.matchAll(/[\p{Script=Han}]{2,}/gu)].flatMap(match => [...match[0]].slice(0, -1).map((_, i) => match[0].slice(i, i + 2)))
  return [...new Set([...(lower.match(/[a-z][a-z0-9_]{1,}/g) || []), ...chinese])].slice(0, 150)
}
function score(words: string[], text: string): number { const lower = text.toLowerCase(); return words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0) }
export class ProjectEvidenceService {
  constructor(private readonly store: ProjectEvidenceStore) {}
  list(context: RequestContext): Promise<EvidenceProjectSummary[]> { return this.store.list(account(context)) }
  async import(context: RequestContext, input: EvidenceProjectInput): Promise<EvidenceProjectSummary> {
    const userId = account(context)
    validateEvidenceProject(input)
    // Canonicalize fields; hashes identify exact imported contents, including uncommitted code.
    const clean: EvidenceProjectInput = { project_id: input.project_id, name: input.name.trim(), aliases: [...input.aliases], sources: input.sources.map(source => ({ source_id: source.source_id, path: source.path, kind: source.kind, sha256: source.sha256, revision: source.revision, start_line: source.start_line, topics: [...source.topics], notes: source.notes, content: source.content })) }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(clean)))
    const version = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
    await assertContextActive(context)
    const existing = await this.store.read(userId, input.project_id, version)
    const project = existing || { ...clean, version, imported_at: new Date().toISOString() }
    await this.store.save(userId, project)
    return summary(project)
  }
  async select(context: RequestContext, projectIds: string[]): Promise<EvidenceSelection[]> {
    const userId = account(context)
    if (projectIds.length > 6 || new Set(projectIds).size !== projectIds.length) throw new AppError('最多选择 6 份项目证据，不能重复。', 400)
    const result: EvidenceSelection[] = []
    for (const id of projectIds) {
      const project = await this.store.read(userId, id)
      if (!project) throw new AppError('所选项目证据已不存在，请重新选择。', 409)
      result.push({ project_id: project.project_id, name: project.name, version: project.version })
    }
    return result
  }
  async retrieve(context: RequestContext, selections: EvidenceSelection[], question: string, preceding = ''): Promise<EvidenceHit[]> {
    const userId = account(context)
    const projects: EvidenceProject[] = []
    for (const selected of selections) {
      const project = await this.store.read(userId, selected.project_id, selected.version)
      if (!project) throw new AppError('本轮项目证据快照缺失，请恢复本地备份后重试。', 409)
      projects.push(project)
    }
    const matches = (project: EvidenceProject, text: string) => [project.name, project.project_id, ...project.aliases].some(alias => text.toLowerCase().includes(alias.toLowerCase()))
    const explicit = projects.filter(project => matches(project, question))
    const contextual = projects.filter(project => matches(project, preceding))
    const scoped = explicit.length ? explicit : contextual.length === 1 ? contextual : projects
    const cleanQuestion = question.replace(/(?:怎么|如何|什么|哪些|是否|怎样|为什么|请问|请说明|请介绍|这个|项目|你的|是怎么|一下)/g, ' ')
    const words = terms(cleanQuestion)
    const candidates: Array<{ score: number; hit: Omit<EvidenceHit, 'citation_id'> }> = []
    for (const project of scoped) for (const source of project.sources) {
      const lines = source.content.split('\n')
      const affinity = score(words, source.topics.join(' ') + ' ' + source.path) * 2
      for (let start = 0; start < lines.length; start += 28) {
        // Bound by complete lines so cited line ranges remain truthful.
        const selected: string[] = []
        for (const line of lines.slice(start, start + 36)) {
          if (selected.join('\n').length + line.length > 2000) break
          selected.push(line)
        }
        const text = selected.join('\n')
        const relevance = score(words, text)
        if (!text.trim() || relevance === 0) continue
        candidates.push({ score: affinity + relevance, hit: { project_id: project.project_id, project_name: project.name, version: project.version, source_id: source.source_id, path: source.path, kind: source.kind, kind_label: EVIDENCE_KIND_LABELS[source.kind], sha256: source.sha256, revision: source.revision, start_line: source.start_line + start, end_line: source.start_line + start + selected.length - 1, text, notes: source.notes } })
      }
    }
    const selected: EvidenceHit[] = []
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (selected.some(hit => hit.project_id === candidate.hit.project_id && hit.source_id === candidate.hit.source_id && Math.abs(hit.start_line - candidate.hit.start_line) < 36)) continue
      selected.push({ ...candidate.hit, citation_id: `S${selected.length + 1}` })
      if (selected.length >= 4) break
    }
    return selected
  }
}
export function validateEvidenceCitations(answer: string, hits: EvidenceHit[]): EvidenceHit[] {
  const cited = [...new Set([...answer.matchAll(/\[S(\d+)\]/g)].map(match => `S${match[1]}`))]
  if (cited.some(id => !hits.some(hit => hit.citation_id === id)) || (hits.length && !cited.length)) throw new AppError('模型未正确引用本轮项目证据，未保存此答法，请重试。', 502, 'invalid_evidence_citation')
  return hits.filter(hit => cited.includes(hit.citation_id))
}

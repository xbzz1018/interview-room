import { boundaryApp, jsonHeaders } from './contracts/test-app.ts'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectEvidenceService, InterviewService, validateEvidenceCitations, type EvidenceProjectInput, type InterviewDependencies, type RequestContext } from '@techspar/core'
import { FileProjectEvidenceStore } from '@techspar/platform'
import { BunInterviewSessionRepository, BunResumeInterviewStateRepository } from '@techspar/db'
const roots: string[] = []
const context: RequestContext = { requestId: 'qa', userId: 'alice', signal: new AbortController().signal }
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'interview-evidence-')); roots.push(root); const store = new FileProjectEvidenceStore(root); return { root, store, service: new ProjectEvidenceService(store) } }
function project(id = 'atlas-python', content = 'Atlas Python 使用订单幂等唯一约束，避免重复创建。'): EvidenceProjectInput { return { project_id: id, name: id === 'atlas-java' ? 'Atlas Java' : 'Atlas Python', aliases: [id === 'atlas-java' ? 'Atlas Java' : 'Atlas Python'], sources: [{ source_id: 'source', path: 'src/orders.py', kind: 'personal_reproduction', sha256: 'a'.repeat(64), revision: 'head; dirty', start_line: 900, topics: ['幂等','订单'], notes: '个人复现不是历史实习结果', content }] } }
test('same snapshot import is idempotent; changed working contents get a different immutable version', async () => {
  const { service, root } = await fixture()
  const first = await service.import(context, project())
  const repeated = await service.import(context, project())
  expect(repeated.version).toBe(first.version); expect(repeated.imported_at).toBe(first.imported_at)
  const selected = await service.select(context, ['atlas-python'])
  const second = await service.import(context, project('atlas-python', 'Atlas Python 改为事务与消息表，订单幂等 unique key。'))
  expect(second.version).not.toBe(first.version)
  const restarted = new ProjectEvidenceService(new FileProjectEvidenceStore(root))
  const old = await restarted.retrieve(context, selected, 'Atlas Python 订单幂等怎么做？')
  expect(old[0]?.version).toBe(first.version)
  expect(old[0]?.text).toContain('避免重复创建')
  expect(old[0]?.text).not.toContain('消息表')
})
test('projects and source versions are isolated by account', async () => {
  const { service } = await fixture(); await service.import(context, project())
  expect(await service.list({ ...context, userId: 'bob' })).toEqual([])
  await expect(service.select({ ...context, userId: 'bob' }, ['atlas-python'])).rejects.toThrow('不存在')
})
test('a direct project mention selects the correct implementation among similarly named projects', async () => {
  const { service } = await fixture(); await service.import(context, project()); await service.import(context, project('atlas-java', 'Atlas Java 使用订单幂等键与 Java 缓存。'))
  const hits = await service.retrieve(context, await service.select(context, ['atlas-python', 'atlas-java']), 'Atlas Python 订单如何幂等？', '上题讨论了 Atlas Java')
  expect(hits.length).toBeGreaterThan(0); expect(hits.every(hit => hit.project_id === 'atlas-python')).toBe(true)
})
test('tail evidence keeps the actual file line range and a complete snippet', async () => {
  const { service } = await fixture()
  const lines = Array.from({ length: 110 }, (_, index) => index === 95 ? 'unique_tail_marker: 幂等订单由唯一约束保证' : `# filler ${index}`)
  await service.import(context, project('atlas-python', lines.join('\n')))
  const hits = await service.retrieve(context, await service.select(context, ['atlas-python']), 'unique_tail_marker 是什么？')
  expect(hits[0]?.text).toContain('unique_tail_marker')
  const offset = hits[0]!.text.split('\n').findIndex(line => line.includes('unique_tail_marker'))
  expect(hits[0]!.start_line + offset).toBe(995)
  expect(hits[0]!.text.split('\n').length).toBe(hits[0]!.end_line - hits[0]!.start_line + 1)
})
test('no relevant source produces no fabricated citation', async () => {
  const { service } = await fixture(); await service.import(context, project())
  expect(await service.retrieve(context, await service.select(context, ['atlas-python']), 'QNN AHardwareBuffer Android')).toEqual([])
  expect(validateEvidenceCitations('没有对应资料，待补充。', [])).toEqual([])
  expect(() => validateEvidenceCitations('根据 [S1] 可以证明。', [])).toThrow('正确引用')
})
test('invalid paths, duplicate source IDs, oversized snapshots and invalid kinds are rejected before writes', async () => {
  const { service } = await fixture()
  for (const path of ['../secret', 'C:/private/file', '/private/file', 'src/../secret', 'src\\secret']) { const input = project(); input.sources[0]!.path = path; await expect(service.import(context, input)).rejects.toThrow('格式无效') }
  const duplicate = project(); duplicate.sources.push(duplicate.sources[0]!); await expect(service.import(context, duplicate)).rejects.toThrow()
  const large = project(); large.sources[0]!.content = 'x'.repeat(60001); await expect(service.import(context, large)).rejects.toThrow()
  await expect(service.select(context, Array.from({ length: 7 }, (_, index) => String(index)))).rejects.toThrow('最多')
  expect(() => service.list({ ...context, userId: undefined })).toThrow()
  expect(await service.list(context)).toEqual([])
})
test('missing immutable evidence is reported rather than replaced with the current version', async () => {
  const { service } = await fixture(); await service.import(context, project())
  await expect(service.retrieve(context, [{ project_id: 'atlas-python', name: 'Atlas Python', version: '0'.repeat(64) }], '幂等')).rejects.toThrow('快照缺失')
})
test('a generated answer must cite only supplied IDs and respect material kind labels', async () => {
  const { service } = await fixture(); await service.import(context, project())
  const hits = await service.retrieve(context, await service.select(context, ['atlas-python']), '订单幂等')
  expect(hits[0]?.kind_label).toContain('不等于原实习')
  expect(() => validateEvidenceCitations('见 [S999]', hits)).toThrow()
  expect(() => validateEvidenceCitations('没有引用', hits)).toThrow()
  expect(validateEvidenceCitations('源码演示唯一约束 [S1]。', hits)).toHaveLength(1)
})
test('resume reference uses the selected frozen version and caches answer plus source preview', async () => {
  const { root, service: evidence } = await fixture(); await evidence.import(context, project())
  const selected = await evidence.select(context, ['atlas-python'])
  const sessions = new BunInterviewSessionRepository(join(root, 'test.db')), states = new BunResumeInterviewStateRepository(join(root, 'test.db')); sessions.initialize(); states.initialize()
  let calls = 0; let input = ''
  const deps = { sessions, states, evidence, ai: { async complete(_context: unknown, messages: Array<{ content: string }>) { calls++; input = JSON.stringify(messages); return '可以用唯一约束 [S1]；此为个人复现，原经历待补充。' } }, profile: {} } as unknown as InterviewDependencies
  const interview = new InterviewService(deps)
  try {
    await sessions.create({ sessionId: 'session', userId: 'alice', mode: 'resume', meta: { evidence_projects: selected } })
    await sessions.appendMessage('session', 'alice', 'assistant', 'Atlas Python 订单幂等怎样保证？')
    await sessions.appendMessage('session', 'alice', 'user', '先查询再插入')
    await sessions.updateStatus('session', 'alice', 'ended')
    await evidence.import(context, project('atlas-python', '新版本完全不同，但也处理订单幂等。'))
    const first = await interview.referenceAnswer(context, 'session', 'resume-turn-1')
    expect(input).toContain('避免重复创建'); expect(input).not.toContain('新版本完全不同')
    expect(first.sources?.[0]?.start_line).toBe(900)
    const cached = await new InterviewService(deps).referenceAnswer(context, 'session', 'resume-turn-1')
    expect(cached.cached).toBe(true); expect(cached.sources).toEqual(first.sources); expect(calls).toBe(1)
  } finally { sessions.close(); states.close() }
})
test('invalid model citations are not cached as successful references', async () => {
  const { root, service: evidence } = await fixture(); await evidence.import(context, project())
  const sessions = new BunInterviewSessionRepository(join(root, 'test.db')), states = new BunResumeInterviewStateRepository(join(root, 'test.db')); sessions.initialize(); states.initialize()
  try {
    await sessions.create({ sessionId: 'session', userId: 'alice', mode: 'resume', meta: { evidence_projects: await evidence.select(context, ['atlas-python']) } })
    await sessions.appendMessage('session', 'alice', 'assistant', 'Atlas Python 订单幂等？'); await sessions.appendMessage('session', 'alice', 'user', '不知道'); await sessions.updateStatus('session', 'alice', 'ended')
    const interview = new InterviewService({ sessions, states, evidence, ai: { async complete() { return '伪造的 [S999]' } }, profile: {} } as unknown as InterviewDependencies)
    await expect(interview.referenceAnswer(context, 'session', 'resume-turn-1')).rejects.toThrow('正确引用')
    expect((await sessions.get('session', 'alice'))?.reference_answers).toEqual({})
  } finally { sessions.close(); states.close() }
})

test('HTTP evidence import/list is authenticated, schema checked and backed by real files', async () => {
  const { service } = await fixture(); const app = boundaryApp({ evidence: service })
  expect((await app.request('/api/project-evidence')).status).toBe(401)
  expect((await app.request('/api/project-evidence', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sources: [] }) })).status).toBe(422)
  const response = await app.request('/api/project-evidence', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(project()) })
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('application/json')
  const imported = await response.json() as Record<string, unknown>
  expect(imported.version).toMatch(/^[a-f0-9]{64}$/); expect(imported.imported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  const normalized = { ...imported, version: 'snapshot-sha256', imported_at: '2026-11-11T00:00:00.000Z' }
  expect(normalized).toEqual(await Bun.file('tests-ts/contracts/fixtures/responses/project-evidence.json').json())
  const listing = await app.request('/api/project-evidence', { headers: jsonHeaders }); expect(listing.status).toBe(200)
  const body = await listing.json() as { items: Array<Record<string, unknown>> }
  expect(body.items).toEqual([imported]); expect(JSON.stringify(body)).not.toContain('避免重复创建')
  expect({ items: [normalized] }).toEqual(await Bun.file('tests-ts/contracts/fixtures/responses/project-evidence-list.json').json())
})

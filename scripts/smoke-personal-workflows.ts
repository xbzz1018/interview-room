import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { zipSync, strToU8, gunzipSync } from 'fflate'
import { FileProviderSettingsRepository } from '@techspar/platform'
import { textPdf } from '../tests-ts/fixtures/text-pdf.ts'

// Explicit opt-in: these synthetic workflows use the configured provider's quota.
if (!process.argv.includes('--live')) throw new Error('Pass --live and set TECHSPAR_SMOKE_PROVIDER_DATA_DIR to use an existing provider configuration. No keys are accepted on the command line.')
const resumeOnly = process.argv.includes('--resume-only')
const root = process.cwd()
const source = process.env.TECHSPAR_SMOKE_PROVIDER_DATA_DIR
if (!source) throw new Error('TECHSPAR_SMOKE_PROVIDER_DATA_DIR is required (the directory containing interviews.db).')
const sourceDb = new Database(join(source, 'interviews.db'), { readonly: true })
const sourceUser = sourceDb.query<{ id: string }, [string]>('SELECT id FROM users WHERE email = ?').get(process.env.TECHSPAR_SMOKE_EMAIL || 'admin@techspar.local')
sourceDb.close()
if (!sourceUser) throw new Error('No matching source user')
const provider = await new FileProviderSettingsRepository(source).loadProvider(sourceUser.id)
if (!provider.llm?.api_key) throw new Error('Source user has no configured text provider')
const secrets = [provider.llm.api_key, provider.embedding?.api_key, ...Object.values(provider.llm.http_headers || {})].filter((value): value is string => Boolean(value))
const clean = (value: unknown) => secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), String(value)).slice(0, 4000)
const qa = join(root, 'local_tools', `personal-acceptance-${Date.now()}`)
await mkdir(qa, { recursive: true })
const executable = resolve(process.env.TECHSPAR_SMOKE_BACKEND || join(root, 'apps/desktop/resources/backend', process.platform === 'win32' ? 'techspar-api.exe' : 'techspar-api'))
const model = process.env.TECHSPAR_SMOKE_EMBEDDING_MODEL || 'Xenova/bge-small-zh-v1.5'
const modelCache = process.env.TECHSPAR_SMOKE_MODEL_CACHE || join(qa, 'models')
const password = `qa-${crypto.randomUUID()}`
const runtime = join(resolve(executable, '..'), 'onnxruntime')
const checks: Array<{ name: string; ok: boolean; elapsedMs: number; error?: string }> = []
let child: ReturnType<typeof Bun.spawn> | undefined, origin = '', token = '', stderr = ''
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

async function start(directory: string) {
  await mkdir(directory, { recursive: true })
  const env: Record<string, string | undefined> = {
    ...process.env, HOST: '127.0.0.1', PORT: '0', TECHSPAR_BASE_DIR: directory,
    TECHSPAR_DATA_DIR: join(directory, 'data'), DB_PATH: join(directory, 'data/interviews.db'),
    TECHSPAR_MODEL_CACHE_DIR: modelCache, JWT_SECRET: `qa-${crypto.randomUUID()}`, VOICEPRINT_ENCRYPTION_KEY: crypto.randomUUID(),
    DEFAULT_EMAIL: 'admin@techspar.local', DEFAULT_PASSWORD: password, ALLOW_REGISTRATION: 'false',
    ...(process.platform === 'win32' ? { PATH: `${runtime};${process.env.PATH}` } : process.platform === 'darwin' ? { DYLD_LIBRARY_PATH: runtime } : { LD_LIBRARY_PATH: runtime }),
  }
  for (const key of Object.keys(env)) if (key.startsWith('PLATFORM_') || key.startsWith('COPILOT_') || key === 'TECHSPAR_EXTENSIONS') delete env[key]
  const running = Bun.spawn([executable], { cwd: directory, env, stdout: 'pipe', stderr: 'pipe' })
  child = running
  void (async () => { for await (const chunk of running.stderr) stderr = (stderr + new TextDecoder().decode(chunk)).slice(-12000) })()
  origin = ''; token = ''
  const timer = setTimeout(() => running.kill(), 30000)
  try {
    const reader = running.stdout.getReader(), decoder = new TextDecoder(); let buffered = ''
    while (!origin) {
      const chunk = await reader.read(); if (chunk.done) throw new Error(`Backend exited before readiness: ${clean(stderr)}`)
      buffered += decoder.decode(chunk.value, { stream: true }); const lines = buffered.split('\n'); buffered = lines.pop() || ''
      for (const line of lines) { try { const item = JSON.parse(line); if (item.event === 'techspar:ready') origin = `http://127.0.0.1:${item.port}` } catch { /* log line */ } }
    }
    void (async () => { while (!(await reader.read()).done) { /* drain logger */ } })()
  } finally { clearTimeout(timer) }
  token = (await request('/api/auth/login', { email: 'admin@techspar.local', password })).token
}
async function stop() { if (child) { child.kill(); await child.exited; child = undefined } }
async function raw(path: string, body?: unknown, method?: string) {
  return fetch(`${origin}${path}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(180000),
  })
}
async function request(path: string, body?: unknown, method?: string): Promise<any> {
  const response = await raw(path, body, method)
  const text = await response.text()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${clean(text)}`)
  return JSON.parse(text)
}
async function stream(path: string, body?: unknown) {
  const response = await raw(path, body ?? {})
  const text = await response.text()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${clean(text)}`)
  const events = text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
  for (const event of events) if (event.error) throw new Error(clean(event.error))
  assert(events.length, 'Stream had no events')
  return events
}
async function check<T>(name: string, action: () => Promise<T>): Promise<T | undefined> {
  const begin = Date.now()
  try { const value = await action(); checks.push({ name, ok: true, elapsedMs: Date.now() - begin }); return value }
  catch (error) { checks.push({ name, ok: false, elapsedMs: Date.now() - begin, error: clean(error instanceof Error ? error.message : error) }); return undefined }
  finally { console.log(JSON.stringify(checks.at(-1))) }
}
const form = (filename: string, bytes: Uint8Array) => { const value = new FormData(); value.append('file', new File([bytes as Uint8Array<ArrayBuffer>], filename)); return value }
async function review(sessionId: string) {
  const until = Date.now() + 360000
  while (Date.now() < until) {
    const status = await request(`/api/tasks/${sessionId}`)
    if (status.status === 'error') throw new Error(clean(status.error))
    if (status.status === 'done') {
      // The review can become visible before profile synchronization finishes.
      const value = await request(`/api/interview/review/${sessionId}`)
      assert(value.review?.length, 'Review is empty')
      if (value.meta?.profile_extract_failed === true) throw new Error('Review was saved but profile/memory synchronization failed')
      if (value.meta?.profile_extract_failed === false) return value
    }
    await Bun.sleep(1500)
  }
  throw new Error('Review and profile synchronization exceeded 360 seconds')
}

async function runWorkflows() {
  await start(join(qa, 'primary'))
  const settings = await request('/api/settings')
  const embedding = { ...settings.embedding, backend: 'local', local_model: model, local_path: '', api_base: '', api_key: '', api_model: '' }
  await check('configure isolated profile', () => request('/api/settings', { ...settings, llm: provider.llm, embedding, training: { num_questions: 5, divergence: 2 } }, 'PUT'))
  for (const path of ['/api/topics', '/api/profile', '/api/interview/history', '/api/personal-agent/documents']) await check(`read ${path}`, () => request(path))
  await check('local Chinese embedding inference', async () => { const value = await request('/api/settings/test-embedding', embedding); assert(value.ok, value.error || 'Embedding test failed') })
  const pdf = textPdf()
  await check('upload valid text PDF', () => request('/api/resume/upload', form('synthetic-resume.pdf', pdf)))
  if (!resumeOnly) {
    await check('infer role from PDF with live model', async () => { const value = await request('/api/profile/infer-target-role', {}); assert(value.target_role, 'Missing target role') })
    await check('parse PDF into structured resume', async () => { const value = await request('/api/resume/parse', {}); assert(value.parsed?.basic, 'No parsed basic fields') })
  }
  const resume = await check('start resume interview', async () => { const value = await request('/api/interview/start', { mode: 'resume', target_role: 'Java 后端开发', job_description: '' }); assert(value.message?.trim(), 'Empty opening'); return value })
  if (resume) {
    if (!resumeOnly) await check('resume interview non-streaming answer', async () => { const value = await request('/api/interview/chat', { session_id: resume.session_id, message: '这是验收用的虚构简历。我用 Java 和 Spring 开发了订单接口，数据库是 PostgreSQL。' }); assert(value.message || value.is_finished, 'No reply') })
    await check('resume interview SSE answer', async () => { const events = await stream('/api/interview/chat/stream', { session_id: resume.session_id, message: '数据库事务使用唯一约束和请求幂等键，避免重复写入。我先解释约束，再说明并发测试。' }); assert(events.some(event => event.done), 'Stream never completed') })
    await check('resume recoverable transcript', async () => { const value = await request(`/api/interview/session/${resume.session_id}/resume`); assert(value.transcript?.length >= 3, 'Transcript was not saved') })
    await check('end resume and generate review', async () => { await request(`/api/interview/end/${resume.session_id}`, {}); await review(resume.session_id) })
  }
  if (resumeOnly) return
  const topic = (await check('create synthetic knowledge topic', () => request('/api/topics', { key: 'personal-qa-java', name: 'Java 后端验收', icon: '🧪' })))?.key
  if (topic) {
    const prefix = `/api/knowledge/${topic}`
    await check('knowledge Markdown create and edit', async () => { await request(`${prefix}/core`, { filename: 'qa.md', content: '# 事务\n事务提供原子性、一致性、隔离性、持久性。' }); await request(`${prefix}/core/qa.md`, { content: '# Java 事务\n使用 Spring 事务与数据库唯一约束实现可靠写入。' }, 'PUT') })
    const docx = zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), 'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Java knowledge: use transactions and test concurrency.</w:t></w:r></w:p></w:body></w:document>') })
    for (const [filename, bytes] of [['notes.txt', strToU8('Java uses classes. Spring supports dependency injection and transactions.')], ['pdf-notes.pdf', pdf], ['word-notes.docx', docx]] as const) {
      await check(`knowledge import ${filename}`, () => request(`${prefix}/upload`, form(filename, bytes)))
    }
    await check('knowledge list and high-frequency questions', async () => { const value = await request(`${prefix}/core`); assert(Object.keys(value).length, 'No files'); await request(`${prefix}/high_freq`, { content: '事务隔离如何影响并发？' }, 'PUT'); assert((await request(`${prefix}/high_freq`)).content.includes('事务'), 'High frequency not persisted') })
    const drill = await check('generate five topic drill questions', async () => { const value = await request('/api/interview/start', { mode: 'topic_drill', topic, num_questions: 5, divergence: 2 }); assert(value.questions?.length === 5, 'Expected five questions'); return value })
    if (drill) {
      const answers = drill.questions.map((q: any) => ({ question_id: q.id, answer: '我会先界定适用场景，使用事务和唯一约束保障一致性，用并发用例验证结果，并记录边界条件。', confidence: 3 }))
      await check('save and reload drill draft', async () => { assert((await request(`/api/interview/draft/${drill.session_id}`, { answers })).saved, 'Draft not saved'); const value = await request(`/api/interview/session/${drill.session_id}/resume`); assert(value.questions.length === 5, 'Draft questions missing') })
      await check('generate reference answer without standard answer', async () => { const value = await request('/api/interview/reference-answer', { session_id: drill.session_id, question_id: drill.questions[0].id }); assert(value.reference_answer?.trim(), 'Empty reference'); assert((await request('/api/interview/reference-answer', { session_id: drill.session_id, question_id: drill.questions[0].id })).cached, 'Reference cache missing') })
      await check('score five answers and generate drill review', async () => { await request(`/api/interview/end/${drill.session_id}`, { answers }); const value = await review(drill.session_id); assert(value.scores?.length === 5, 'Missing question scores') })
      await check('question graph after review', () => request(`/api/graph/${topic}`))
    }
    await check('delete knowledge file', () => request(`${prefix}/core/notes.md`, undefined, 'DELETE'))
  }
  const document = await check('personal PDF upload and vector indexing', async () => { const value = await request('/api/personal-agent/documents', form('qa-personal.pdf', textPdf('Synthetic project codename: QA-ORCHID. Database: PostgreSQL. Language: Java.'))); assert(value.status === 'ready' && value.chunk_count > 0, `Document not indexed: ${clean(value.error || value.status)}`); return value })
  const chat = await check('personal agent retrieves indexed evidence', async () => { const value = await request('/api/personal-agent/chat', { message: '验收资料里的项目代号是什么？只回答代号并指出资料。' }); assert(value.message?.content.includes('QA-ORCHID'), 'Model did not use indexed evidence'); assert(value.message.sources?.some((item: any) => item.filename === 'qa-personal.pdf'), 'No source attribution'); return value })
  if (chat) await check('personal agent conversation persistence', async () => { const value = await request(`/api/personal-agent/conversations/${chat.conversation_id}`); assert(value.messages?.length >= 2, 'Conversation not saved') })
  const jd = { request_id: crypto.randomUUID(), jd_text: '招聘 Java 后端开发工程师，熟悉 Java、Spring Boot、PostgreSQL、REST API、数据库事务与并发控制；需要编写单元测试并能够定位线上接口性能和可靠性问题。', company: '合成验收公司', position: 'Java 后端工程师', use_resume: true }
  const preview = await check('JD analysis with uploaded resume', async () => { const value = await request('/api/job-prep/preview', jd); assert(value.preview?.focus_areas?.length, 'Empty JD analysis'); return value })
  if (preview) await check('JD training generation and retry idempotency', async () => { const value = await request('/api/job-prep/start', { ...jd, session_id: preview.session_id }); assert(value.questions?.length >= 4, 'Missing JD questions'); const retry = await request('/api/job-prep/start', { ...jd, session_id: preview.session_id }); assert(retry.session_id === value.session_id && JSON.stringify(retry.questions) === JSON.stringify(value.questions), 'Retry generated a duplicate') })
  await check('rebuild vector indexes with real local inference', async () => { const events = await stream('/api/settings/rebuild-index'); assert(events.some(event => event.done), 'No terminal rebuild event') })
  await check('missing optional speech credentials returns guidance', async () => { const response = await raw('/api/transcribe', form('qa.wav', new Uint8Array([82, 73, 70, 70]))); const value = await response.json() as any; assert(!response.ok && response.status !== 500 && /DashScope|配置|key/i.test(value.detail), 'Speech failure was not actionable') })
  await check('invalid settings do not echo API key', async () => { const response = await raw('/api/settings', { ...settings, llm: provider.llm, training: { num_questions: 1, divergence: 2 } }, 'PUT'); const text = await response.text(); assert(response.status === 422 && !text.includes(provider.llm!.api_key), 'Settings validation leaked input') })
  let archive: Uint8Array | undefined
  await check('personal archive export excludes credentials', async () => { const response = await raw('/api/data/export/personal'); assert(response.ok, 'Export failed'); archive = new Uint8Array(await response.arrayBuffer()); const contents = new TextDecoder().decode(gunzipSync(archive)); assert(!contents.includes(provider.llm!.api_key), 'Export included provider key') })
  await stop(); await start(join(qa, 'primary'))
  await check('restart restores settings and interview history', async () => { const value = await request('/api/settings'); assert(value.llm.model === provider.llm!.model && value.llm.reasoning_effort === provider.llm!.reasoning_effort, 'Settings lost'); const history = await request('/api/interview/history'); assert(JSON.stringify(history).includes(resume?.session_id || 'missing'), 'Session lost') })
  if (chat) await check('restart restores personal evidence and chat', async () => { assert((await request('/api/personal-agent/documents')).items.some((item: any) => item.document_id === document?.document_id && item.status === 'ready'), 'Document lost'); assert((await request(`/api/personal-agent/conversations/${chat.conversation_id}`)).messages.length >= 2, 'Chat lost') })
  if (archive) {
    await stop(); await start(join(qa, 'imported'))
    await check('import archive into separate clean profile', async () => { const body = form('qa-backup.tar.gz', archive!); body.append('db_strategy', 'overwrite'); body.append('overwrite_files', 'true'); const value = await request('/api/data/import', body); assert(value.ok !== false, 'Import failed'); const history = await request('/api/interview/history'); assert(JSON.stringify(history).includes(resume?.session_id || 'missing'), 'Imported interview missing') })
  }
}

try {
  await runWorkflows()
} finally {
  await stop()
  const result = { executable, model, textModel: provider.llm.model, reasoningEffort: provider.llm.reasoning_effort, checks, stderr: clean(stderr) }
  await writeFile(join(qa, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ report: join(qa, 'result.json'), passed: checks.filter(check => check.ok).length, failed: checks.filter(check => !check.ok).length }))
  if (checks.some(check => !check.ok)) process.exitCode = 1
}

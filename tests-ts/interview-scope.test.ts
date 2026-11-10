import { expect, test } from 'bun:test'
import type { AppDependencies } from '../apps/api/src/app.ts'
import { createApp } from '../apps/api/src/app.ts'
import { ResumeService, type InterviewSession } from '@techspar/core'
import { realServiceHarness } from './contracts/real-service-harness.ts'

const unused = new Proxy({}, { get() { throw new Error('Retired routes must not reach a use case') } })
const dependencies = {
  auth: unused, registration: { allowRegistration: false }, settings: unused, settingsOperations: unused, quota: unused,
  tokens: unused, knowledge: unused, resume: unused, interview: unused, profile: unused,
  personalAgent: unused, migration: unused,
} as unknown as AppDependencies

test('the default interview host exposes text workflows without any media endpoints', async () => {
  const app = createApp(dependencies)
  const response = await app.request('/openapi.json')
  expect(response.status).toBe(200)
  const spec = await response.json() as { paths: Record<string, unknown> }
  const generated = await Bun.file('packages/contracts/openapi.json').json() as typeof spec
  expect(spec.paths).toEqual(generated.paths)
  for (const path of ['/api/interview/start', '/api/interview/compare-answer', '/api/resume/upload', '/api/personal-agent/documents', '/api/profile']) {
    expect(spec.paths).toHaveProperty(path)
  }
  for (const [method, path] of [['POST', '/api/transcribe'], ['POST', '/api/recording/transcribe'], ['POST', '/api/recording/analyze'], ['POST', '/api/copilot/prep'], ['GET', '/api/voiceprint/status'], ['GET', '/ws/copilot/session']]) {
    expect(spec.paths[path!]).toBeUndefined()
    expect((await app.request(path!, { method })).status).toBe(404)
  }
})

test('a resume service without a speech adapter rejects transcription before touching files or a model', async () => {
  const service = new ResumeService({ store: unused, extractor: unused, index: unused, ai: unused } as never)
  await expect(service.transcribe({ requestId: 'qa', userId: 'qa', signal: new AbortController().signal }, 'a.webm', new Uint8Array([1]))).rejects.toMatchObject({ status: 410, code: 'feature_retired' })
})

test('unfinished archived sessions can be read without generating a report or changing their data', async () => {
  const h = await realServiceHarness()
  try {
    const now = new Date().toISOString()
    for (const mode of ['recording', 'copilot'] as const) {
      const session: InterviewSession = {
        session_id: 'legacy-' + mode, user_id: 'user-a', mode, topic: null,
        meta: {}, questions: [], transcript: [{ role: 'user', content: '历史回答原文' }],
        scores: [], weak_points: [], overall: {}, reference_answers: {},
        status: 'ongoing', review: null, created_at: now, updated_at: now,
      }
      await h.seedSession(session)
      const response = await h.request('/api/interview/review/' + session.session_id)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ mode, review: null, transcript: session.transcript, status: 'ongoing' })
      expect((await h.sessions.get(session.session_id, 'user-a'))?.status).toBe('ongoing')
    }
    expect(h.remaining).toEqual([])
  } finally { await h.dispose() }
})

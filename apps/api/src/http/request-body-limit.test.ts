import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { requestBodyLimit } from './request-body-limit.ts'

test('request body limit rejects oversized JSON before the route handler', async () => {
  const app = new Hono()
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))
  app.post('/api/auth/login', (c) => c.text('handled'))
  const response = await app.request('/api/auth/login', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
  expect(response.status).toBe(413)
})

test('upload routes receive route-specific size limits', async () => {
  const app = new Hono()
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))
  app.post('/api/data/import', (c) => c.text('handled'))
  const response = await app.request('/api/data/import', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
  expect(response.status).toBe(200)
})

test('personal document replacement accepts multipart-sized bodies and text editing accepts Chinese content', async () => {
  const app = new Hono()
  app.use('/api/*', (c, next) => requestBodyLimit(c.req.path)(c, next))
  app.post('/api/personal-agent/documents/doc/replace', (c) => c.text('handled'))
  app.put('/api/personal-agent/documents/doc', (c) => c.text('handled'))
  expect((await app.request('/api/personal-agent/documents/doc/replace', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(200)
  expect((await app.request('/api/personal-agent/documents/doc', { method: 'PUT', body: JSON.stringify({ content: '文'.repeat(600000), revision: 'r' }) })).status).toBe(200)
})

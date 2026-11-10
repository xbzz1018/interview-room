import { expect, test } from 'bun:test'
import type { Session } from 'electron'
import { configureInterviewPermissions, sameOrigin } from './permissions.ts'

test('text interviews deny microphone, camera and screen permission requests', () => {
  let check: Parameters<Session['setPermissionCheckHandler']>[0] = null
  let request: Parameters<Session['setPermissionRequestHandler']>[0]
  let display: Parameters<Session['setDisplayMediaRequestHandler']>[0]
  configureInterviewPermissions({
    setPermissionCheckHandler(handler) { check = handler },
    setPermissionRequestHandler(handler) { request = handler },
    setDisplayMediaRequestHandler(handler) { display = handler },
  })
  expect(check).toBeFunction()
  for (const permission of ['media', 'display-capture']) {
    expect(check!(null, permission as never, 'http://127.0.0.1:8000', {} as never)).toBe(false)
    let allowed: boolean | undefined
    request!(null as never, permission as never, (value) => { allowed = value }, {} as never)
    expect(allowed).toBe(false)
  }
  let streams: unknown
  display!({} as never, (value) => { streams = value })
  expect(streams).toEqual({})
})

test('IPC trust checks still match exact origins and reject invalid URLs', () => {
  expect(sameOrigin('http://127.0.0.1:8000/interview/a', 'http://127.0.0.1:8000')).toBe(true)
  expect(sameOrigin('http://127.0.0.1:9000', 'http://127.0.0.1:8000')).toBe(false)
  expect(sameOrigin('invalid', 'http://127.0.0.1:8000')).toBe(false)
})

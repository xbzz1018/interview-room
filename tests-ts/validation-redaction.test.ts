import { expect, test } from 'bun:test'
import { fastApiValidationBody } from '../apps/api/src/http/validation.ts'

test('validation failures never echo passwords, provider keys or authorization headers', () => {
  const value = fastApiValidationBody('json', [{ code: 'invalid_type', path: ['training'], message: 'invalid' }], {
    llm: { model: 'kept', api_key: 'private-api-key', http_headers: { authorization: 'private-header' } },
    services: { oss_access_key_id: 'private-oss', dashscope_api_key: 'private-dash' }, password: 'private-password',
  })
  const encoded = JSON.stringify(value)
  expect(encoded).toContain('kept'); expect(encoded).toContain('[redacted]'); expect(encoded).not.toContain('private-')
})

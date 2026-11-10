import { expect, test } from 'bun:test'
import { AppError, USER_PROVIDER } from '@techspar/core'
import { providerError } from '../packages/providers/src/provider-errors.ts'
import { OpenAiChatDriverFactory } from '@techspar/providers'

const config = { api_base: 'https://synthetic.invalid/v1', api_key: 'synthetic', model: 'model', temperature: 0.7, use_platform: false, source: USER_PROVIDER, compatibility: 'generic' as const }

const signal = new AbortController().signal
test.each([
  [401, 502, 'provider_auth_failed'], [403, 502, 'provider_auth_failed'],
  [400, 502, 'provider_request_rejected'], [404, 502, 'provider_request_rejected'],
  [429, 503, 'provider_rate_limited'], [503, 502, 'provider_unavailable'],
] as const)('sanitizes upstream %s without returning local session errors', async (upstream, status, code) => {
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => new Response(JSON.stringify({ error: { message: 'secret-echo-do-not-show' } }), { status: upstream, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' } })) as unknown as typeof fetch }).create(config)
  const result = await driver.complete([], signal).catch(error => error)
  expect(result).toMatchObject({ status, code })
  expect(result.message).not.toContain('secret-echo')
})
test.each([['Error', 502, 'provider_connection_failed'], ['AbortError', 504, 'provider_timeout']] as const)('maps SDK network errors (%s)', async (name, status, code) => {
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => { throw Object.assign(new Error('synthetic network failure'), { name }) }) as unknown as typeof fetch }).create(config)
  await expect(driver.complete([], signal)).rejects.toMatchObject({ status, code })
}, 10000)
test('retains known errors and cancellation', () => {
  expect(providerError(Object.assign(new TypeError('socket unexpectedly closed'), { code: 'ECONNRESET' }), signal)).toMatchObject({ status: 502, code: 'provider_connection_failed' })
  const known = new AppError('known', 400); expect(providerError(known, signal)).toBe(known)
  const abort = new AbortController(); abort.abort(); const original = new Error('cancelled')
  expect(providerError(original, abort.signal)).toBe(original)
})
test.each(['generic', 'responses'] as const)('handles SDK authorization errors in %s completion and stream', async compatibility => {
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => new Response(JSON.stringify({ error: { message: 'secret-echo' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch }).create({
    api_base: 'https://synthetic.invalid/v1', api_key: 'synthetic', model: 'model', temperature: 0.7, use_platform: false, source: USER_PROVIDER, compatibility,
  })
  await expect(driver.complete([], signal)).rejects.toMatchObject({ status: 502, code: 'provider_auth_failed' })
  await expect((async () => { for await (const _ of driver.stream([], signal)) { /* consume */ } })()).rejects.toMatchObject({ status: 502, code: 'provider_auth_failed' })
})

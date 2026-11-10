import { expect, test } from 'bun:test'
import { USER_PROVIDER, resolveLlmConfig, type ResolvedLlmConfig } from '@techspar/core'
import { OpenAiChatDriverFactory } from '@techspar/providers'

const config: ResolvedLlmConfig = {
  api_base: 'https://gateway.test/v1', api_key: 'synthetic-test-key', model: 'gpt-6.1-sol',
  compatibility: 'responses', reasoning_effort: 'xhigh', temperature: 0.7, use_platform: false, source: USER_PROVIDER,
  http_headers: { 'x-openai-actor-authorization': 'local-image-extension' },
}
const terminal = (type = 'response.completed', text = '回答') => ({
  type, response: {
    id: 'resp_test', status: type === 'response.completed' ? 'completed' : type === 'response.failed' ? 'failed' : 'incomplete',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 23, output_tokens: 11, input_tokens_details: { cached_tokens: 7 } },
    ...(type === 'response.incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    ...(type === 'response.failed' ? { error: { message: 'Provider unavailable' } } : {}),
  },
})
function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('Responses completion preserves the requested model, xhigh, instructions, headers, history and token usage', async () => {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const factory = new OpenAiChatDriverFactory({ fetch: (async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    return sse([
      { type: 'response.reasoning_summary_text.delta', delta: '隐藏推理' },
      { type: 'response.output_text.delta', delta: '回' }, { type: 'response.output_text.delta', delta: '答' }, terminal(),
    ])
  }) as typeof fetch })
  const result = await factory.create(config).complete([
    { role: 'system', content: '你是面试官' }, { role: 'user', content: '第一问' },
    { role: 'assistant', content: '上一轮回答' }, { role: 'user', content: '继续' },
  ], new AbortController().signal, { maxTokens: 2048, temperature: 0, jsonMode: true, reasoningEffort: 'low' })
  expect(result).toEqual({ text: '回答', promptTokens: 23, completionTokens: 11, cachedTokens: 7 })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.url).toBe('https://gateway.test/v1/responses')
  expect(calls[0]!.headers.get('authorization')).toBe('Bearer synthetic-test-key')
  expect(calls[0]!.headers.get('x-openai-actor-authorization')).toBe('local-image-extension')
  expect(calls[0]!.body).toEqual({
    model: 'gpt-6.1-sol', instructions: '你是面试官',
    input: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '上一轮回答' }, { role: 'user', content: '继续' }],
    stream: true, store: false, reasoning: { effort: 'xhigh' }, max_output_tokens: 32768,
    text: { format: { type: 'json_object' } },
  })
})

test('Responses streaming forwards visible text once and reports cached tokens', async () => {
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => sse([
    { type: 'response.output_text.delta', delta: '回' }, { type: 'response.output_text.delta', delta: '答' }, terminal(),
  ])) as unknown as typeof fetch }).create(config)
  let usage: unknown
  const chunks = []
  for await (const value of driver.stream([{ role: 'user', content: '问题' }], new AbortController().signal, { onUsage(value) { usage = value } })) chunks.push(value)
  expect(chunks).toEqual(['回', '答'])
  expect(usage).toEqual({ promptTokens: 23, completionTokens: 11, cachedTokens: 7 })
})

test('a completed-only gateway response still supplies its final text', async () => {
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => sse([terminal()])) as unknown as typeof fetch }).create(config)
  expect((await driver.complete([], new AbortController().signal)).text).toBe('回答')
})

test.each(['response.incomplete', 'response.failed', 'error', 'disconnect'] as const)('does not accept %s as a valid completed answer', async type => {
  const events = [{ type: 'response.output_text.delta', delta: 'partial' }]
  const ending = type === 'disconnect' ? [] : type === 'error' ? [{ type: 'error', message: 'Gateway error' }] : [terminal(type)]
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => sse([...events, ...ending])) as unknown as typeof fetch }).create(config)
  await expect(driver.complete([], new AbortController().signal)).rejects.toMatchObject({ code: 'provider_response_error' })
})

test('retries only empty completed Responses and includes every attempt in usage', async () => {
  const delays: number[] = []
  let count = 0
  const driver = new OpenAiChatDriverFactory({
    fetch: (async () => sse([terminal('response.completed', count++ === 0 ? '' : '回答')])) as unknown as typeof fetch,
    retryDelaysMs: [5], sleep: async milliseconds => { delays.push(milliseconds) },
  }).create(config)
  expect(await driver.complete([], new AbortController().signal)).toEqual({ text: '回答', promptTokens: 46, completionTokens: 22, cachedTokens: 14 })
  expect(delays).toEqual([5])
})

test('keeps provider errors and aborts instead of changing the selected effort', async () => {
  let calls = 0
  const driver = new OpenAiChatDriverFactory({ fetch: (async () => {
    calls++
    return new Response(JSON.stringify({ error: { message: 'Unsupported xhigh', type: 'invalid_request_error' } }), { status: 400, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch }).create(config)
  await expect(driver.complete([], new AbortController().signal)).rejects.toMatchObject({ status: 502, code: 'provider_request_rejected' })
  expect(calls).toBe(1)
  const aborted = new AbortController(); aborted.abort()
  await expect(driver.complete([], aborted.signal)).rejects.toThrow()
  expect(calls).toBe(1)
})

test('settings resolution retains the Responses protocol and headers without mutating them', () => {
  const resolved = resolveLlmConfig(config, {
    llm: { api_base: '', api_key: '', model: '' }, embedding: { api_base: '', api_key: '', api_model: '' },
    dailyCallLimit: 0, tokenLimit: 0, tokenWindow: 'day',
  })
  expect(resolved).toMatchObject(config)
  expect(resolved.http_headers).not.toBe(config.http_headers)
})

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generate, requestBody, sseEvents } from '../src/gateway.ts';
import { defaultSettings as emptySettings } from '../src/model.ts';
import { extractPdf, extractImage, imageData } from '../src/extract.ts';

const defaultSettings = { ...emptySettings, model: 'gpt-6.1-sol', effort: 'xhigh', headers: { 'x-interview-client': 'synthetic-test' } };

test('Responses request honors model, reasoning and storage preference', () => {
  const body = requestBody(defaultSettings, [{ role: 'user', content: 'x' }]);
  assert.equal(body.model, 'gpt-6.1-sol'); assert.deepEqual(body.reasoning, { effort: 'xhigh' }); assert.equal(body.store, false); assert.equal(body.stream, true);
});
test('Chat protocol uses its own parameters', () => {
  const body = requestBody({ ...defaultSettings, protocol: 'chat' }, [{ role: 'user', content: 'x' }]);
  assert.equal(body.reasoning_effort, 'xhigh'); assert.ok(!('input' in body)); assert.ok(!('reasoning' in body));
});
test('SSE parser survives fragmented UTF8, CRLF and multi-line data', async () => {
  const bytes = new TextEncoder().encode('event: test\r\ndata: 中文\r\ndata: two\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const events = []; for await (const event of sseEvents(body)) events.push(event);
  assert.deepEqual(events, [{ event: 'test', data: '中文\ntwo' }]);
});
type Calls = { body?: Record<string, unknown>; actor?: string; auth?: string; path?: string; apiKey?: string; version?: string };
async function mockGateway(events: string, action: (url: string, calls: Calls) => Promise<void>, status = 200) {
  const calls: Calls = {};
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; calls.body = JSON.parse(raw);
    calls.actor = String(req.headers['x-interview-client']); calls.auth = req.headers.authorization;
    calls.path = req.url; calls.apiKey = req.headers['x-api-key'] as string | undefined; calls.version = req.headers['anthropic-version'] as string | undefined;
    res.writeHead(status, { 'Content-Type': 'text/event-stream' }); res.end(events);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try { await action(`http://127.0.0.1:${address.port}/v1`, calls); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
test('real HTTP Responses streaming sends bearer and custom header, only emits answer text', async () => {
  await mockGateway('data: {"type":"response.reasoning_summary_text.delta","delta":"secret thought"}\n\ndata: {"type":"response.output_text.delta","delta":"问题内容"}\n\ndata: {"type":"response.completed"}\n\n', async (baseUrl, calls) => {
    const parts: string[] = [];
    const value = await generate({ ...defaultSettings, baseUrl, apiKey: 'test-key' }, [{ role: 'user', content: 'x' }], new AbortController().signal, text => parts.push(text));
    assert.equal(value, '问题内容'); assert.deepEqual(parts, ['问题内容']); assert.equal(calls.auth, 'Bearer test-key'); assert.equal(calls.actor, 'synthetic-test');
  });
});
test('stream without completed marker never becomes successful', async () => {
  await mockGateway('data: {"type":"response.output_text.delta","delta":"片段"}\n\n', async baseUrl => {
    await assert.rejects(generate({ ...defaultSettings, baseUrl }, [], new AbortController().signal, () => undefined), /提前结束/);
  });
});
test('incomplete response preserves visible draft but reports failure', async () => {
  await mockGateway('data: {"type":"response.output_text.delta","delta":"片段"}\n\ndata: {"type":"response.incomplete"}\n\n', async baseUrl => {
    let draft = ''; await assert.rejects(generate({ ...defaultSettings, baseUrl }, [], new AbortController().signal, value => { draft = value; }), /未完成/); assert.equal(draft, '片段');
  });
});
test('gateway HTTP errors do not echo upstream body or key', async () => {
  await mockGateway('upstream sensitive diagnostic', async baseUrl => {
    await assert.rejects(generate({ ...defaultSettings, baseUrl }, [], new AbortController().signal, () => undefined), /拒绝认证/);
  }, 401);
});
test('image signatures checked and malformed PDF rejected without changing material', async () => {
  assert.throws(() => imageData(Buffer.from('not-an-image').toString('base64'), 'image/png'), /真实/);
  await assert.rejects(extractPdf(Buffer.from('broken').toString('base64')), /有效 PDF/);
});
test('local PDF extraction reads actual synthetic PDF text', async () => {
  const stream = 'BT /F1 12 Tf 30 100 Td (Synthetic resume backend developer) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  assert.match(await extractPdf(Buffer.from(pdf).toString('base64')), /Synthetic resume backend developer/);
});
test('optional image recognition uses protocol specific input and never saves a material', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  for (const protocol of ['responses', 'chat'] as const) await mockGateway(JSON.stringify(protocol === 'responses'
    ? { status: 'completed', output_text: '合成识别文字' } : { choices: [{ finish_reason: 'stop', message: { content: '合成识别文字' } }] }), async (baseUrl, calls) => {
    const output = await extractImage({ ...defaultSettings, protocol, baseUrl }, png, 'image/png', new AbortController().signal);
    assert.equal(output, '合成识别文字');
    if (protocol === 'responses') { assert.ok(Array.isArray(calls.body?.input)); assert.equal(calls.body?.store, false); assert.equal(calls.body?.messages, undefined); }
    else { assert.ok(Array.isArray(calls.body?.messages)); assert.equal(calls.body?.input, undefined); }
  });
});

test('native Claude HTTP stream uses Messages authentication and ignores thinking text', async () => {
  const stream = [
    { type: 'message_start', message: { role: 'assistant' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '合成回答' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' },
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join('');
  await mockGateway(stream, async (baseUrl, calls) => {
    const chunks: string[] = [];
    assert.equal(await generate({ ...defaultSettings, baseUrl, protocol: 'anthropic', apiKey: 'claude-test-key', effort: 'high' }, [{ role: 'system', content: '训练说明' }, { role: 'user', content: '问题' }], new AbortController().signal, value => chunks.push(value)), '合成回答');
    assert.equal(calls.path, '/v1/messages'); assert.equal(calls.apiKey, 'claude-test-key'); assert.equal(calls.auth, undefined); assert.equal(calls.version, '2023-06-01');
    assert.equal(calls.body?.system, '训练说明'); assert.deepEqual(calls.body?.messages, [{ role: 'user', content: '问题' }]);
    assert.deepEqual(calls.body?.thinking, { type: 'adaptive' }); assert.deepEqual(calls.body?.output_config, { effort: 'high' }); assert.deepEqual(chunks, ['合成回答']);
  });
});

test('native Claude output cannot succeed on truncated content or a missing message stop', async () => {
  for (const stream of [
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"片段"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\ndata: {"type":"message_stop"}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"片段"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  ]) await mockGateway(stream, async baseUrl => {
    await assert.rejects(generate({ ...defaultSettings, baseUrl, protocol: 'anthropic', effort: '' }, [], new AbortController().signal, () => undefined), /截断|提前结束/);
  });
});

test('Chat compatibility uses selected max_tokens and omits unsupported reasoning by default', async () => {
  await mockGateway('data: {"choices":[{"delta":{"content":"兼容回答"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', async (baseUrl, calls) => {
    assert.equal(await generate({ ...defaultSettings, baseUrl, protocol: 'chat', tokenParameter: 'max_tokens', effort: '' }, [], new AbortController().signal, () => undefined), '兼容回答');
    assert.equal(calls.path, '/v1/chat/completions'); assert.equal(calls.body?.max_tokens, 4096); assert.equal(calls.body?.max_completion_tokens, undefined); assert.equal(calls.body?.reasoning_effort, undefined);
  });
});

test('native Claude image recognition sends base64 image blocks and reads only completed text', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  await mockGateway(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: '图片文字' }] }), async (baseUrl, calls) => {
    assert.equal(await extractImage({ ...defaultSettings, baseUrl, protocol: 'anthropic', effort: '', apiKey: 'claude-test' }, png, 'image/png', new AbortController().signal), '图片文字');
    assert.equal(calls.apiKey, 'claude-test'); assert.equal(calls.body?.stream, false);
    assert.ok(JSON.stringify(calls.body?.messages).includes('"media_type":"image/png"'));
  });
});

import { expect, test } from 'bun:test';
import { responseErrorText } from '../src/api/errors';

test('shows actionable backend messages instead of raw JSON', async () => {
  expect(await responseErrorText(new Response(JSON.stringify({ detail: '请检查 API Key', code: 'provider_auth_failed' }), { status: 502 }))).toBe('请检查 API Key');
});
test('formats validation errors and does not display submitted settings', async () => {
  const message = await responseErrorText(new Response(JSON.stringify({ detail: [{ msg: '模型不能为空', input: { api_key: 'private' } }] }), { status: 422 }));
  expect(message).toBe('输入有误：模型不能为空'); expect(message).not.toContain('private');
});
test('provides safe guidance for generic errors and HTML gateway pages', async () => {
  for (const body of ['{"detail":"Internal Server Error"}', '<html>Bad gateway</html>']) {
    expect(await responseErrorText(new Response(body, { status: 500 }))).toContain('请检查模型配置');
  }
});

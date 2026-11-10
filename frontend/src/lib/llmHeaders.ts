export function parseLlmHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('附加请求头需填写 JSON 对象，例如 {"x-openai-actor-authorization":"local-image-extension"}') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(item => typeof item !== 'string')) {
    throw new Error('附加请求头的名称和值都必须是字符串')
  }
  return parsed as Record<string, string>
}

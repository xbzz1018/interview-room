type ValidationIssue = {
  code: string
  path: PropertyKey[]
  message: string
}

const LOCATION: Record<string, string> = {
  json: 'body',
  form: 'body',
  param: 'path',
  query: 'query',
  header: 'header',
  cookie: 'cookie',
}

function redactInput(value: unknown, depth = 0): unknown {
  if (depth > 12) return null
  if (Array.isArray(value)) return value.map(item => redactInput(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /password|api_?key|token|secret|access_key|http_headers|authorization/i.test(key) ? '[redacted]' : redactInput(item, depth + 1),
  ]))
  return value
}

export function fastApiValidationBody(target: string, issues: readonly ValidationIssue[], input?: unknown) {
  return {
    detail: issues.map((issue) => {
      const missing = issue.code === 'invalid_type' && issue.message.includes('received undefined')
      return {
        type: missing ? 'missing' : issue.code,
        loc: [LOCATION[target] || target, ...issue.path.map((part) => typeof part === 'symbol' ? String(part) : part)],
        msg: missing ? 'Field required' : issue.message,
        input: redactInput(input) ?? null,
      }
    }),
  }
}

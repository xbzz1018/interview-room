import { Label } from './ui/label'

export default function LlmHeadersField({ value, onChange, disabled = false }: {
  value: string
  onChange(value: string): void
  disabled?: boolean
}) {
  return <details className="mt-4 rounded-2xl border border-border/80 p-3 text-sm text-dim">
    <summary className="cursor-pointer">网关附加请求头（可选）</summary>
    <div className="mt-3 space-y-2">
      <Label htmlFor="llm-http-headers">请求头 JSON</Label>
      <textarea id="llm-http-headers" rows={3} disabled={disabled} value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={'{"x-openai-actor-authorization":"local-image-extension"}'}
        className="w-full rounded-xl border border-border bg-input px-3 py-2 font-mono text-xs text-text outline-none focus-visible:border-primary disabled:opacity-50" />
      <p className="text-xs">按网关要求填写 JSON 对象；API Key 仍填写在上方。</p>
    </div>
  </details>
}

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type KnowledgeDraft = { base: string; content: string }
function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length < 1800 && /^knowledge-draft:[^:]+:[^:]+:(core|high_freq):[^:]*$/.test(key)
}
function validDraft(value: unknown): value is KnowledgeDraft {
  return Boolean(value && typeof value === 'object' && typeof (value as KnowledgeDraft).base === 'string' && typeof (value as KnowledgeDraft).content === 'string' && JSON.stringify(value).length <= 500_000)
}
export class KnowledgeDraftStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}
  private async load(): Promise<Record<string, KnowledgeDraft>> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return {}; throw error }
    if (raw.length > 8_000_000) throw new Error('Draft storage is too large')
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([key, draft]) => !validKey(key) || !validDraft(draft))) throw new Error('Invalid draft storage; original file retained')
    return value as Record<string, KnowledgeDraft>
  }
  async read(): Promise<Record<string, KnowledgeDraft>> { await this.pending; return this.load() }
  write(key: unknown, draft: unknown): Promise<void> {
    if (!validKey(key) || (draft !== null && !validDraft(draft))) return Promise.reject(new Error('Invalid knowledge draft'))
    const operation = this.pending.then(async () => {
      const values = await this.load()
      if (draft === null) delete values[key]; else values[key] = { base: (draft as KnowledgeDraft).base, content: (draft as KnowledgeDraft).content }
      const serialized = JSON.stringify(values)
      if (Object.keys(values).length > 500 || serialized.length > 8_000_000) throw new Error('Draft storage limit reached')
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }).catch(() => undefined) }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
  async flush(): Promise<void> { await this.pending }
}

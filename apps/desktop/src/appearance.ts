import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DesktopAppearanceTheme } from './contracts.ts'

export function isAppearanceTheme(value: unknown): value is DesktopAppearanceTheme {
  return value === 'navy' || value === 'teal' || value === 'wine'
}

// A desktop origin changes with its local port. Store appearance outside browser storage.
export class AppearanceStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}

  async read(): Promise<DesktopAppearanceTheme | undefined> {
    await this.pending
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      const theme = value && typeof value === 'object' ? (value as Record<string, unknown>).theme : undefined
      return isAppearanceTheme(theme) ? theme : undefined
    } catch { return undefined }
  }

  write(theme: unknown): Promise<void> {
    if (!isAppearanceTheme(theme)) return Promise.reject(new Error('Invalid appearance theme'))
    const operation = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify({ theme }) + '\n', { encoding: 'utf8', flag: 'wx' })
        await rename(temporary, this.path)
      } finally { await rm(temporary, { force: true }).catch(() => undefined) }
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }

  async flush(): Promise<void> { await this.pending }
}

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResumeFile, ResumeStatus, ResumeStore } from '@techspar/core'

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function safeFilename(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') throw new Error('Invalid resume filename')
  return value
}

export class FileResumeStore implements ResumeStore {
  constructor(private readonly dataDir: string) {}

  private readonly pending = new Map<string, Promise<void>>()

  private async exclusive<T>(userId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(userId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    this.pending.set(userId, current)
    await previous
    try { return await action() }
    finally { release(); if (this.pending.get(userId) === current) this.pending.delete(userId) }
  }

  private directory(userId: string): string {
    return join(this.dataDir, 'users', safeSegment(userId, 'user id'), 'resume')
  }

  private async find(userId: string): Promise<string | undefined> {
    const directory = this.directory(userId)
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      return entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))?.name
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
  }

  async status(userId: string): Promise<ResumeStatus> {
    return this.exclusive(userId, async () => {
      const filename = await this.find(userId)
      if (!filename) return { has_resume: false }
      return { has_resume: true, filename, size: (await stat(join(this.directory(userId), filename))).size }
    })
  }

  async read(userId: string): Promise<ResumeFile | undefined> {
    return this.exclusive(userId, async () => {
      const filename = await this.find(userId)
      if (!filename) return undefined
      return { filename, bytes: new Uint8Array(await readFile(join(this.directory(userId), filename))) }
    })
  }

  async replace(userId: string, filename: string, bytes: Uint8Array): Promise<void> {
    await this.exclusive(userId, async () => {
      const directory = this.directory(userId)
      await mkdir(directory, { recursive: true })
      const target = join(directory, safeFilename(filename))
      const temporary = join(directory, `.${crypto.randomUUID()}.upload`)
      try {
        await writeFile(temporary, bytes, { flag: 'wx' })
        // Commit first: a failed rename must leave the previous resume readable.
        await rename(temporary, target)
        const entries = await readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && entry.name !== filename && entry.name.toLowerCase().endsWith('.pdf')) await rm(join(directory, entry.name))
        }
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
  }

  async delete(userId: string): Promise<boolean> {
    return this.exclusive(userId, async () => {
      const filename = await this.find(userId)
      if (!filename) return false
      await rm(join(this.directory(userId), filename))
      return true
    })
  }
}

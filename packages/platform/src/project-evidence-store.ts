import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvidenceProject, EvidenceProjectSummary, ProjectEvidenceStore } from '@techspar/core'
import { atomicWriteJson } from './provider-settings-repository.ts'
function segment(value: string): string { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid evidence identifier'); return value }
export class FileProjectEvidenceStore implements ProjectEvidenceStore {
  constructor(private readonly dataDir: string) {}
  private root(user: string) { return join(this.dataDir, 'users', segment(user), 'project-evidence') }
  async read(user: string, project: string, version?: string): Promise<EvidenceProject | undefined> {
    const root = join(this.root(user), segment(project))
    try {
      const revision = version || (JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { version: string }).version
      if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid evidence version')
      return JSON.parse(await readFile(join(root, `${revision}.json`), 'utf8')) as EvidenceProject
    } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return undefined; throw error }
  }
  async list(user: string): Promise<EvidenceProjectSummary[]> {
    const entries = await readdir(this.root(user), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    const summaries: EvidenceProjectSummary[] = []
    for (const entry of entries.filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(entry.name))) {
      const project = await this.read(user, entry.name)
      if (project) summaries.push({ project_id: project.project_id, name: project.name, aliases: project.aliases, version: project.version, source_count: project.sources.length, imported_at: project.imported_at })
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name))
  }
  async save(user: string, project: EvidenceProject): Promise<void> {
    const root = join(this.root(user), segment(project.project_id))
    if (!/^[a-f0-9]{64}$/.test(project.version)) throw new Error('Invalid evidence version')
    await mkdir(root, { recursive: true })
    const target = join(root, `${project.version}.json`)
    // Only expose a version after its complete atomic write. Existing versions are immutable.
    if (!await this.read(user, project.project_id, project.version)) await atomicWriteJson(target, project)
    await atomicWriteJson(join(root, 'current.json'), { version: project.version })
  }
}

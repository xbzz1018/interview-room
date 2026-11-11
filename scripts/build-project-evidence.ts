import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateEvidenceProject, type EvidenceKind, type EvidenceProjectInput } from '@techspar/core'
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const manifestPath = option('manifest'), outputPath = option('output')
if (!manifestPath || !outputPath) throw new Error('Usage: bun scripts/build-project-evidence.ts --manifest=FILE --output=FILE')
// A manifest is an explicit file allowlist. No directory traversal, network or model calls.
type Source = { source_id: string; path: string; source_kind: string; anchor?: string; line?: number; topics?: string[]; notes?: string }
type Project = { project_id: string; name: string; primary_root: string; aliases: string[]; sources: Source[] }
const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as { projects: Project[] }
const kinds: Record<string, EvidenceKind> = { current_project_implementation: 'current_source', upstream_contribution_code: 'current_source', public_reproduction: 'personal_reproduction', historical_validation_summary: 'historical_record', curated_interview_material: 'user_reported_history', teaching_reference: 'reference_material', public_reference_runbook: 'reference_material', experiment_runbook: 'personal_reproduction', reference_scope: 'reference_material', claim_review_notes: 'interview_draft', offline_fixture_demo: 'reference_material' }
const allowed = new Set(['.py', '.ts', '.tsx', '.js', '.java', '.cpp', '.h', '.sql', '.md', '.txt', '.json'])
if (!Array.isArray(manifest.projects) || manifest.projects.length > 12) throw new Error('Invalid source manifest')
const projects: EvidenceProjectInput[] = []
for (const project of manifest.projects) {
  const sources: EvidenceProjectInput['sources'] = []
  for (const source of project.sources) {
    const path = resolve(source.path), name = basename(path)
    if (!allowed.has(extname(name).toLowerCase()) || /(?:^\.|\.env|secret|credential|password|token\.json|package-lock|bun\.lock)/i.test(name) || /[\\/](?:node_modules|\.git|dist|build|data)[\\/]/i.test(path)) throw new Error(`Excluded source: ${source.source_id}`)
    // Reject aliases/symlinks to a different target, as the manifest author selected exact files.
    const actual = await realpath(path)
    if (actual.toLowerCase() !== path.toLowerCase()) throw new Error(`Source target changed: ${source.source_id}`)
    if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error(`Source too large: ${source.source_id}`)
    const raw = await readFile(path), content = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
    const lines = content.split('\n')
    const anchor = source.anchor ? lines.findIndex(line => line.includes(source.anchor!)) : Math.max(0, (source.line || 1) - 1)
    if (anchor < 0) throw new Error(`Source anchor not found: ${source.source_id}`)
    const start = Math.max(0, anchor - 15)
    const selected: string[] = []
    for (const line of lines.slice(start, start + 180)) { if (selected.join('\n').length + line.length > 18000) break; selected.push(line) }
    let revision = 'no-git; content hash identifies this snapshot'
    try {
      const root = execFileSync('git', ['-C', dirname(path), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', path], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      revision = `${head}${dirty ? '; working tree differs/untracked' : '; tracked file clean'}`
    } catch { /* Standalone Markdown is also a valid explicit source. */ }
    let display = relative(resolve(project.primary_root), path).replaceAll('\\', '/')
    if (display.startsWith('..') || isAbsolute(display)) display = `materials/${source.source_id}/${name}`
    sources.push({ source_id: source.source_id, path: display, kind: kinds[source.source_kind] || source.source_kind as EvidenceKind, sha256: createHash('sha256').update(raw).digest('hex'), revision, start_line: start + 1, topics: source.topics || [], notes: source.notes || '', content: selected.join('\n') })
  }
  const item = { project_id: project.project_id, name: project.name, aliases: project.aliases, sources }
  validateEvidenceProject(item); projects.push(item)
}
await mkdir(dirname(resolve(outputPath)), { recursive: true })
await writeFile(resolve(outputPath), JSON.stringify({ projects }, null, 2))
console.log(JSON.stringify({ projects: projects.length, sources: projects.reduce((sum, project) => sum + project.sources.length, 0), modelCalls: 0 }))

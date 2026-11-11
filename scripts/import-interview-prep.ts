import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ProjectEvidenceService, type EvidenceProjectInput, type TopicMap } from '@techspar/core'
import { FileKnowledgeStore, FileProjectEvidenceStore } from '@techspar/platform'
// Explicit local files only. This importer never calls a model or changes résumé/settings.
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const packPath = option('pack'), dataDir = option('data-dir'), userId = option('user')
if (!packPath || !dataDir || !userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error('Usage: bun scripts/import-interview-prep.ts --pack=FILE --data-dir=DIR --user=ID')
const pack = JSON.parse(await readFile(resolve(packPath), 'utf8')) as { projects: EvidenceProjectInput[]; topics: Array<{ key: string; name: string; cards: Array<{ filename: string; content: string }> }> }
if (!Array.isArray(pack.projects) || !Array.isArray(pack.topics) || pack.projects.length > 12 || pack.topics.length > 12) throw new Error('Invalid local preparation pack')
const context = { requestId: 'local-prep-import', userId, signal: new AbortController().signal }
const evidence = new ProjectEvidenceService(new FileProjectEvidenceStore(resolve(dataDir)))
const knowledge = new FileKnowledgeStore(resolve(dataDir))
const topics: TopicMap = await knowledge.loadTopics(userId)
const report = { created: [] as string[], unchanged: [] as string[], preservedEdits: [] as string[], projects: [] as string[] }
for (const entry of pack.topics) {
  if (!/^resume_[a-z0-9_]+$/.test(entry.key) || !Array.isArray(entry.cards) || entry.cards.length > 50) throw new Error('Invalid preparation topic')
  if (!topics[entry.key]) topics[entry.key] = { name: entry.name, icon: '🗂️', dir: entry.key }
  const topic = topics[entry.key]!
  await knowledge.ensureTopic(userId, topic.dir, topic.name)
  const existing = new Map((await knowledge.listCore(userId, topic.dir)).map(file => [file.filename, file.content]))
  for (const card of entry.cards) {
    if (!/^[A-F][0-9]{2}\.md$/.test(card.filename) || typeof card.content !== 'string' || card.content.length > 20000) throw new Error('Invalid question card')
    const key = `${entry.key}/${card.filename}`
    if (existing.has(card.filename)) {
      if (existing.get(card.filename) === card.content) report.unchanged.push(key)
      else report.preservedEdits.push(key)
    } else { await knowledge.writeCore(userId, topic.dir, card.filename, card.content, 'create'); report.created.push(key) }
  }
}
await knowledge.saveTopics(userId, topics)
for (const project of pack.projects) report.projects.push((await evidence.import(context, project)).project_id)
await mkdir('local_tools', { recursive: true })
await writeFile('local_tools/prep-import-result.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ created: report.created.length, unchanged: report.unchanged.length, preservedEdits: report.preservedEdits.length, projects: report.projects.length }))

import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeDraftStore } from './knowledge-drafts.ts'
const roots: string[] = []
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'interview-drafts-')); roots.push(root); const path = join(root, 'drafts.json'); return { path, store: new KnowledgeDraftStore(path) } }
const key = 'knowledge-draft:user-a:python:core:notes.md'
test('drafts survive a new desktop process, retain account scope and flush the latest rapid change', async () => {
  const { path, store } = await fixture()
  const writes = [store.write(key, { base: 'original', content: 'first' }), store.write(key, { base: 'original', content: 'latest' }), store.write('knowledge-draft:user-b:python:core:notes.md', { base: '', content: 'other account' })]
  await store.flush(); await Promise.all(writes)
  const restored = await new KnowledgeDraftStore(path).read()
  expect(restored[key]).toEqual({ base: 'original', content: 'latest' })
  expect(Object.keys(restored)).toHaveLength(2)
  await store.write(key, null)
  expect((await new KnowledgeDraftStore(path).read())[key]).toBeUndefined()
})
test('invalid renderer keys and oversize drafts cannot replace existing storage', async () => {
  const { path, store } = await fixture()
  await store.write(key, { base: '', content: 'keep' })
  await expect(store.write('../anything', { base: '', content: 'bad' })).rejects.toThrow()
  await expect(store.write(key, { base: '', content: 'x'.repeat(500001) })).rejects.toThrow()
  expect((await new KnowledgeDraftStore(path).read())[key]?.content).toBe('keep')
})
test('corrupt draft files are preserved and errors remain actionable instead of erasing old data', async () => {
  const { path, store } = await fixture()
  await writeFile(path, '{damaged')
  await expect(store.read()).rejects.toThrow()
  await expect(store.write(key, { base: '', content: 'new' })).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('{damaged')
})

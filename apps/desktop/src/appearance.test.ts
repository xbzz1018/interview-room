import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppearanceStore } from './appearance.ts'

const roots: string[] = []
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'interview-room-appearance-')); roots.push(root)
  const path = join(root, 'appearance.json')
  return { path, store: new AppearanceStore(path) }
}

test('appearance survives a new desktop instance independently of browser origins', async () => {
  const { path, store } = await fixture()
  expect(await store.read()).toBeUndefined()
  await store.write('wine')
  expect(await new AppearanceStore(path).read()).toBe('wine')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ theme: 'wine' })
})

test('rapid choices are written in order and flush waits for the final choice', async () => {
  const { store } = await fixture()
  const choices = ['wine', 'teal', 'navy'].map(theme => store.write(theme))
  await store.flush()
  await Promise.all(choices)
  expect(await store.read()).toBe('navy')
})

test('invalid renderer values are rejected without replacing the saved theme', async () => {
  const { store } = await fixture()
  await store.write('teal')
  await expect(store.write({ theme: 'wine' })).rejects.toThrow('Invalid appearance theme')
  await expect(store.write('../anything')).rejects.toThrow('Invalid appearance theme')
  expect(await store.read()).toBe('teal')
})

test('damaged or obsolete preferences fall back and can be replaced', async () => {
  const { path, store } = await fixture()
  await writeFile(path, '{broken')
  expect(await store.read()).toBeUndefined()
  await writeFile(path, JSON.stringify({ theme: 'orange' }))
  expect(await store.read()).toBeUndefined()
  await store.write('navy')
  expect(await store.read()).toBe('navy')
})

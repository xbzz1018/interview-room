import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Native ONNX modules must load from disk, with their matching DLLs beside them. */
export async function loadLocalTransformers(): Promise<typeof import('@huggingface/transformers')> {
  const runtime = join(dirname(process.execPath), 'transformers-runtime', 'transformers.mjs')
  return existsSync(runtime) ? import(pathToFileURL(runtime).href) : import('@huggingface/transformers')
}

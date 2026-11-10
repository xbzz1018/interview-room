import { expect, test } from 'bun:test'
import { PortableDocumentTextExtractor } from '@techspar/platform'
import { textPdf } from './fixtures/text-pdf.ts'

test('reads real PDF text repeatedly without detaching the input buffer', async () => {
  const extractor = new PortableDocumentTextExtractor()
  const bytes = textPdf('Java Spring SQL synthetic resume')
  expect(await extractor.extract('resume.pdf', bytes)).toContain('Java Spring SQL synthetic resume')
  expect(await extractor.extract('resume.pdf', bytes)).toContain('Java Spring SQL synthetic resume')
  expect(bytes.byteLength).toBeGreaterThan(100)
  expect(await extractor.extract('from-disk.pdf', Buffer.from(bytes))).toContain('Java Spring SQL synthetic resume')
})

test('reports invalid PDF extraction with an actionable document error', async () => {
  await expect(new PortableDocumentTextExtractor().extract('broken.pdf', new TextEncoder().encode('%PDF-1.4\nbroken'))).rejects.toMatchObject({ status: 400, code: 'invalid_document' })
})

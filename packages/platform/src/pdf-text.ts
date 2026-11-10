import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError } from '@techspar/core'

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // PDF.js loads its worker and native canvas at runtime. Keep their real paths in compiled desktop builds.
  const packagedRoot = join(dirname(process.execPath), 'pdf-runtime', 'node_modules', 'pdfjs-dist')
  const runtimeRoot = process.env.TECHSPAR_PDFJS_DIR || (existsSync(packagedRoot) ? packagedRoot : undefined)
  try {
    const pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') = runtimeRoot
      ? await import(pathToFileURL(join(runtimeRoot, 'legacy', 'build', 'pdf.mjs')).href)
      : await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({
      // Buffer.slice() keeps a Buffer; PDF.js requires a plain Uint8Array.
      data: Uint8Array.from(bytes),
      useSystemFonts: true,
      ...(runtimeRoot ? {
        standardFontDataUrl: `${join(runtimeRoot, 'standard_fonts')}/`,
        cMapUrl: `${join(runtimeRoot, 'cmaps')}/`, cMapPacked: true,
        wasmUrl: `${join(runtimeRoot, 'wasm')}/`,
      } : {}),
    })
    try {
      const document = await task.promise
      const pages: string[] = []
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number)
        try { pages.push((await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')) }
        finally { page.cleanup() }
      }
      return pages.join('\n')
    } finally { await task.destroy() }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException') throw new AppError('PDF 已加密，请先移除密码再上传。', 400, 'document_password_required')
    if (name === 'InvalidPDFException') throw new AppError('PDF 内容损坏或格式无效，请重新导出 PDF 后上传。', 400, 'invalid_document')
    throw new AppError('PDF 读取失败，请检查文件是否能正常打开；桌面版请使用包含完整 PDF 运行依赖的程序包。', 422, 'document_extraction_failed')
  }
}

import { crc32, inflateRawSync } from 'node:zlib';
import { fileBytes } from './extract.ts';
import { InputError } from './model.ts';

// Read only the main document text; no links, macros, relationships or external entities are executed.
export function extractDocx(value: unknown): string {
  const bytes = Buffer.from(fileBytes(value)), limit = 2000000;
  try {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('zip');
    const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16);
    if (count > 5000 || count === 0 || offset > end || offset === 0xffffffff || bytes.readUInt32LE(end + 12) !== end - offset) throw new Error('zip');
    let position = offset, xml = '';
    for (let i = 0; i < count; i++) {
      if (position + 46 > end || bytes.readUInt32LE(position) !== 0x02014b50) throw new Error('zip');
      const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10);
      const compressed = bytes.readUInt32LE(position + 20), size = bytes.readUInt32LE(position + 24);
      const nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32);
      if (position + 46 + nameLength + extraLength + commentLength > end) throw new Error('zip');
      const name = bytes.subarray(position + 46, position + 46 + nameLength).toString('utf8');
      if (name === 'word/document.xml') {
        const local = bytes.readUInt32LE(position + 42);
        if (flags & 1 || ![0, 8].includes(method) || size > limit || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('zip');
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        if (start + compressed > bytes.length) throw new Error('zip');
        const compressedBytes = bytes.subarray(start, start + compressed);
        const content = method === 0 ? compressedBytes : inflateRawSync(compressedBytes, { maxOutputLength: limit });
        if (content.length !== size || content.length > limit || crc32(content) !== bytes.readUInt32LE(position + 16)) throw new Error('zip');
        xml = content.toString('utf8'); break;
      }
      position += 46 + nameLength + extraLength + commentLength;
    }
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('xml');
    const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
      if (entity.startsWith('#')) { const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''; }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity];
    });
    const result = Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g), match => match[1] !== undefined ? decode(match[1]) : match[0].startsWith('<w:tab') ? '\t' : '\n').join('').trim();
    if (!result) throw new InputError('DOCX 中没有可提取文字，请先核对文档内容');
    if (result.length > 60000) throw new InputError('DOCX 文字超过 60000 字符，请拆分');
    return result;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('DOCX 解析失败，文件可能已损坏、加密或过大；可以另存为 TXT/Markdown 后导入');
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractDocx } from '../src/docx.ts';

function document(xml: string, compressed = true): Buffer {
  const name = Buffer.from('word/document.xml'), content = Buffer.from(xml), bytes = compressed ? deflateRawSync(content) : content;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(compressed ? 8 : 0, 8);
  local.writeUInt32LE(crc32(content), 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(compressed ? 8 : 0, 10);
  central.writeUInt32LE(crc32(content), 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}
test('DOCX locally extracts both deflated and stored text, entities, paragraphs and line breaks', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>合成 &amp; &#x4e2d;</w:t><w:tab/><w:t>文</w:t><w:br/><w:t>下一行</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>';
  for (const compressed of [false, true]) assert.equal(extractDocx(document(xml, compressed).toString('base64')), '合成 & 中\t文\n下一行\n第二段');
});
test('DOCX refuses corrupt archives, mismatched checksum, entity declarations and empty documents', () => {
  assert.throws(() => extractDocx(Buffer.from('broken').toString('base64')), /解析失败/);
  const damaged = document('<w:p><w:t>text</w:t></w:p>', false); damaged[50] ^= 1;
  assert.throws(() => extractDocx(damaged.toString('base64')), /解析失败/);
  assert.throws(() => extractDocx(document('<!DOCTYPE x><w:t>bad</w:t>').toString('base64')), /解析失败/);
  assert.throws(() => extractDocx(document('<w:document/>').toString('base64')), /没有可提取文字/);
});
test('DOCX refuses oversized compressed XML and text without silently truncating', () => {
  assert.throws(() => extractDocx(document(`<w:t>${'x'.repeat(60001)}</w:t>`).toString('base64')), /60000/);
  assert.throws(() => extractDocx(document(`<w:t>${'x'.repeat(2000001)}</w:t>`).toString('base64')), /解析失败/);
});

/** A real text PDF; unlike a %PDF header stub this exercises PDF.js and its worker. */
export function textPdf(text = 'Test Candidate: Java, Spring, SQL. Built a synthetic backend service.'): Uint8Array {
  const content = `BT /F1 12 Tf 40 740 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, value] of objects.entries()) { offsets.push(output.length); output += `${index + 1} 0 obj\n${value}\nendobj\n` }
  const xref = output.length
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(output)
}

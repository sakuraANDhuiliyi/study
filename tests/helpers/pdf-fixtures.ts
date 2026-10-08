import { PDFDocument } from 'pdf-lib';

/** Valid, inert fixture PDFs. No PDF actions are ever executed by these tests. */
export function plainPdf(objects: (string | Buffer)[] = [], trailer = ''): Buffer {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
    ...objects,
  ];
  const pieces = [Buffer.from('%PDF-1.7\n')];
  const offsets: number[] = [];
  let length = pieces[0].length;
  for (const [index, object] of bodies.entries()) {
    offsets.push(length);
    const entry = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof object === 'string' ? Buffer.from(object) : object,
      Buffer.from('\nendobj\n'),
    ]);
    pieces.push(entry);
    length += entry.length;
  }
  pieces.push(
    Buffer.from(
      `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(pieces);
}

export async function objectStreamPdf(active = false): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([100, 100]);
  if (active) doc.addJavaScript('inert-fixture', 'void 0;');
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

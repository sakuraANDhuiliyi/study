import { HttpException, HttpStatus, UnsupportedMediaTypeException } from '@nestjs/common';
import { execFile } from 'node:child_process';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_INSPECTIONS = 2;
const MAX_INSPECTION_MS = 5000;
let activeInspections = 0;
const unsafePdf = () => new UnsupportedMediaTypeException('PDF 含有活动内容、加密、损坏或超出安全解析限制');

/**
 * Run the mature parser in a disposable process, never on the API event loop.
 * Keep pdf-lib pinned: the DecodeStream allocation guard uses its internal API.
 * The guards add resource limits; PDF syntax and stream decoding remain pdf-lib's.
 */
const INSPECTOR = String.raw`
'use strict';
const {
  PDFDocument, PDFParser, PDFObjectParser, PDFName, PDFDict, PDFArray, PDFRef,
  PDFRawStream, PDFContext, decodePDFRawStream,
} = require('pdf-lib');
const DecodeStream = require('pdf-lib/cjs/core/streams/DecodeStream').default;
const MAX_STREAM = 16 * 1024 * 1024;
const MAX_ALLOCATIONS = 64 * 1024 * 1024;
let allocations = 0, parsed = 0, depth = 0, assigned = 0;
const reject = () => { throw new Error('unsafe PDF'); };
const forbidden = new Set([
  'JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia',
  'RichMediaContent', 'RichMediaSettings', 'XFA', 'SubmitForm', 'ImportData',
  'Rendition', 'Movie', 'Sound', 'GoToR', 'GoToE', 'AA', 'Encrypt',
]);
const checkName = (name) => {
  if (!(name instanceof PDFName)) reject();
  if (forbidden.has(name.decodeText())) reject();
};

// pdf-lib 1.17.1 only normalizes upper-case hex escapes in PDFName.of.
// Normalize the case (without decoding twice) before its existing decoder.
const nameOf = PDFName.of;
PDFName.of = (name) => nameOf(name.replace(/#[0-9a-f]{2}/gi, (escape) => escape.toUpperCase()));
const parseName = PDFObjectParser.prototype.parseName;
PDFObjectParser.prototype.parseName = function () {
  const name = parseName.call(this);
  checkName(name); // Also inspect names that a later duplicate dictionary key overwrites.
  return name;
};
const parseObject = PDFObjectParser.prototype.parseObject;
PDFObjectParser.prototype.parseObject = function () {
  if (++parsed > 200000 || ++depth > 128) reject();
  try { return parseObject.call(this); } finally { depth--; }
};
// Disable recovery that would silently ignore damaged syntax or invent a root.
const skipJibberish = PDFParser.prototype.skipJibberish;
PDFParser.prototype.skipJibberish = function () {
  this.skipWhitespaceAndComments();
  const offset = this.bytes.offset();
  skipJibberish.call(this);
  if (this.bytes.offset() !== offset) reject();
};
PDFParser.prototype.maybeRecoverRoot = function () {
  const root = this.context.lookup(this.context.trailerInfo.Root);
  if (!(root instanceof PDFDict) || root.lookup(PDFName.of('Type')) !== PDFName.of('Catalog')) reject();
};
const matchKeyword = PDFParser.prototype.matchKeyword;
PDFParser.prototype.matchKeyword = function (keyword) {
  const matched = matchKeyword.call(this, keyword);
  if (!matched && Buffer.from(keyword).toString('ascii') === 'endobj') reject();
  return matched;
};
const assign = PDFContext.prototype.assign;
PDFContext.prototype.assign = function (ref, object) {
  if (++assigned > 50000) reject();
  return assign.call(this, ref, object);
};

// V8's heap limit alone does not bound typed-array decompression buffers.
// Account for every allocation before the parser can allocate those buffers.
const ensureBuffer = DecodeStream.prototype.ensureBuffer;
DecodeStream.prototype.ensureBuffer = function (requested) {
  if (!Number.isSafeInteger(requested) || requested < 0 || requested > MAX_STREAM) reject();
  if (requested > this.buffer.byteLength) {
    let size = this.minBufferLength;
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_STREAM) reject();
    while (size < requested) size *= 2;
    if (size > MAX_STREAM || (allocations += size) > MAX_ALLOCATIONS) reject();
  }
  return ensureBuffer.call(this, requested);
};

async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false,
    parseSpeed: 100,
  });
  if (doc.isEncrypted || !(doc.catalog instanceof PDFDict)) reject();
  if (doc.catalog.lookup(PDFName.of('Type')) !== PDFName.of('Catalog')) reject();
  if (doc.getPages().length > 2000) reject();
  const seen = new Set();
  const pending = doc.context.enumerateIndirectObjects().map(([, object]) => object);
  let visited = 0;
  const supported = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);
  const imageCodecs = new Set(['DCTDecode', 'JPXDecode', 'CCITTFaxDecode', 'JBIG2Decode']);
  while (pending.length) {
    if (++visited > 200000) reject();
    const object = pending.pop();
    if (object instanceof PDFName) { checkName(object); continue; }
    if (object instanceof PDFRef) {
      const target = doc.context.lookup(object);
      if (target === undefined) reject();
      pending.push(target);
      continue;
    }
    if (seen.has(object)) continue;
    seen.add(object);
    if (object instanceof PDFRawStream) {
      pending.push(object.dict);
      const filter = object.dict.lookup(PDFName.of('Filter'));
      const filters = filter === undefined ? [] : filter instanceof PDFArray
        ? filter.asArray().map((item) => doc.context.lookup(item)) : [filter];
      if (filters.length > 4 || filters.some((name) => !(name instanceof PDFName))) reject();
      const names = filters.map((name) => name.decodeText());
      const image = object.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image');
      // Opaque, known image encodings contain pixels; dictionary objects are still checked.
      if (names.some((name) => imageCodecs.has(name))) {
        if (!image || names.some((name) => !supported.has(name) && !imageCodecs.has(name))) reject();
      } else {
        if (names.some((name) => !supported.has(name))) reject();
        const decoded = decodePDFRawStream(object).decode();
        if (decoded.length > MAX_STREAM) reject();
      }
    } else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        checkName(key);
        if (key === PDFName.of('OpenAction') && !(doc.context.lookup(value) instanceof PDFArray)) reject();
        pending.push(value);
      }
    } else if (object instanceof PDFArray) {
      pending.push(...object.asArray());
    }
  }
}
const chunks = [];
let length = 0;
process.stdin.on('data', (chunk) => {
  length += chunk.length;
  if (length > 50 * 1024 * 1024) process.exit(2);
  chunks.push(chunk);
});
process.stdin.on('end', () => {
  inspect(Buffer.concat(chunks, length)).then(
    () => process.stdout.write('ok'),
    () => process.exit(2),
  );
});
`;

/** Reject files that cannot be fully inspected; concurrent work never forms an unbounded queue. */
export async function assertSafePdf(
  buffer: Buffer,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (
    buffer.length === 0 ||
    buffer.length > MAX_PDF_BYTES ||
    !/^%PDF-[12]\.\d(?:\r\n|\r|\n)/.test(buffer.subarray(0, 12).toString('latin1')) ||
    !/%%EOF[\x00\t\n\f\r ]*$/.test(buffer.subarray(-1024).toString('latin1'))
  )
    throw unsafePdf();
  const timeoutMs = Math.min(options.timeoutMs ?? MAX_INSPECTION_MS, MAX_INSPECTION_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || options.signal?.aborted) throw unsafePdf();
  if (activeInspections >= MAX_INSPECTIONS)
    throw new HttpException('PDF 安全检查繁忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
  activeInspections++;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        process.execPath,
        ['--max-old-space-size=128', '--no-addons', '-e', INSPECTOR],
        {
          cwd: __dirname,
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 4096,
          // Do not pass API credentials or inherited Node loader flags into the inspector.
          env: { NODE_ENV: 'production' },
          signal: options.signal,
        },
        (error, stdout) => (error || stdout !== 'ok' ? reject(unsafePdf()) : resolve()),
      );
      child.stdin?.on('error', () => {}); // A rejection/timeout may close stdin early (EPIPE).
      child.stdin?.end(buffer);
    });
  } finally {
    activeInspections--;
  }
}

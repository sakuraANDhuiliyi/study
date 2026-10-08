import { Readable, Transform } from 'node:stream';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';

export interface ArchiveEntry {
  name: string;
  size: number;
  source: Buffer | Readable;
}

export function tarHeader(name: string, size: number, date: Date): Buffer {
  // Export paths are server-generated ASCII. Client file names live in the UTF-8 manifest.
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(name) ||
    name.startsWith('/') ||
    name.split('/').includes('..') ||
    Buffer.byteLength(name) > 100
  )
    throw new Error('Unsafe archive path');
  if (!Number.isSafeInteger(size) || size < 0 || size > 0o77777777777)
    throw new Error('Invalid archive entry size');
  const header = Buffer.alloc(512);
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0') + '\0';
  header.write(name, 0, 100, 'ascii');
  header.write(octal(0o600, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(size, 12), 124, 12, 'ascii');
  header.write(octal(Math.floor(date.getTime() / 1000), 12), 136, 12, 'ascii');
  header.fill(32, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('lms', 265, 3, 'ascii');
  header.write('lms', 297, 3, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

export async function* tarContent(
  entries: AsyncIterable<ArchiveEntry>,
  date = new Date(),
): AsyncGenerator<Buffer> {
  for await (const entry of entries) {
    yield tarHeader(entry.name, entry.size, date);
    let actual = 0;
    if (Buffer.isBuffer(entry.source)) {
      actual = entry.source.length;
      if (actual !== entry.size) throw new Error('Archive entry size mismatch');
      yield entry.source;
    } else {
      try {
        for await (const chunk of entry.source) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          actual += bytes.length;
          if (actual > entry.size) throw new Error('Archive entry size mismatch');
          yield bytes;
        }
        if (actual !== entry.size) throw new Error('Archive entry size mismatch');
      } finally {
        entry.source.destroy();
      }
    }
    const padding = (512 - (entry.size % 512)) % 512;
    if (padding) yield Buffer.alloc(padding);
  }
  yield Buffer.alloc(1024);
}

/** Streams TAR -> gzip -> digest meter without buffering the archive in memory. */
export function compressedArchive(entries: AsyncIterable<ArchiveEntry>, date = new Date()) {
  const hash = createHash('sha256');
  let size = 0;
  const input = Readable.from(tarContent(entries, date));
  const zip = createGzip({ level: 6 });
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  input.on('error', (error) => zip.destroy(error));
  zip.on('error', (error) => meter.destroy(error));
  meter.on('close', () => {
    input.destroy();
    zip.destroy();
  });
  const stream = input.pipe(zip).pipe(meter);
  return { stream, digest: () => hash.digest('hex'), size: () => size };
}

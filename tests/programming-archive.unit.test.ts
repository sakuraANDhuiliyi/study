import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { programmingZip } from '../apps/api/src/programming/programming.archive';
import { programmingFilesSchema } from '../apps/api/src/programming/programming.schemas';

test('ZIP stores standard CRC, UTF-8 names, empty files and a valid central directory', () => {
  const files = programmingFilesSchema.parse([
    { path: 'index.html', content: '123456789' },
    { path: 'docs/notes.md', content: '多文件源码：你好\n' },
    { path: 'empty.txt', content: '' },
  ]);
  const zip = programmingZip(files);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(14), 0xcbf43926); // Standard CRC-32 check vector.
  assert.equal(zip.readUInt16LE(6), 0x0800);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 8), 3);
  const centralOffset = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
  assert.equal(centralOffset + zip.readUInt32LE(end + 12), end);
  const directory = mkdtempSync(join(tmpdir(), 'programming-zip-'));
  try {
    const path = join(directory, 'source.zip');
    writeFileSync(path, zip);
    execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
    for (const file of files)
      assert.equal(execFileSync('unzip', ['-p', path, file.path], { encoding: 'utf8' }), file.content);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ZIP remains byte-identical for the same validated snapshot and supports maximum file count', () => {
  const files = programmingFilesSchema.parse(
    Array.from({ length: 24 }, (_, index) => ({
      path: index === 0 ? 'index.html' : `scripts/example-${index}.js`,
      content: `// source ${index}\n`,
    })),
  );
  const first = programmingZip(files),
    second = programmingZip(files);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt16LE(first.length - 22 + 8), 24);
});

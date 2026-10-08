import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compressedArchive, tarHeader, type ArchiveEntry } from '../apps/api/src/communication/archive.ts';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('USTAR标准头部的字节长度、八进制大小与校验和正确', () => {
  const header = tarHeader('submissions/student/v2/notes.txt', 513, new Date('2026-01-01T00:00:00Z'));
  assert.equal(header.length, 512);
  assert.equal(parseInt(header.subarray(124, 135).toString(), 8), 513);
  const expected = parseInt(header.subarray(148, 154).toString(), 8);
  header.fill(32, 148, 156);
  assert.equal(
    [...header].reduce((sum, byte) => sum + byte, 0),
    expected,
  );
  assert.throws(() => tarHeader('../secret.txt', 1, new Date()), /Unsafe/);
  assert.throws(() => tarHeader('/absolute.txt', 1, new Date()), /Unsafe/);
  assert.throws(() => tarHeader('a'.repeat(101), 1, new Date()), /Unsafe/);
  assert.throws(() => tarHeader('valid.txt', -1, new Date()), /size/);
});

test('流式TAR.GZ可由系统tar解析，UTF-8清单、文件内容、摘要可核对', async () => {
  const manifest = Buffer.from(
    JSON.stringify({ version: 2, student: '林同学', originalName: '学习笔记.txt' }),
  );
  const content = Buffer.from('学生第二次正式提交\n');
  async function* entries(): AsyncGenerator<ArchiveEntry> {
    yield { name: 'manifest.json', size: manifest.length, source: manifest };
    yield {
      name: 'submissions/student/v2/notes.txt',
      size: content.length,
      source: Readable.from([content.subarray(0, 7), content.subarray(7)]),
    };
  }
  const archive = compressedArchive(entries(), new Date('2026-01-01T00:00:00Z'));
  const bytes = await collect(archive.stream);
  assert.equal(archive.size(), bytes.length);
  assert.equal(archive.digest(), createHash('sha256').update(bytes).digest('hex'));
  const plain = gunzipSync(bytes);
  assert.equal(plain.length % 512, 0);
  assert(plain.subarray(-1024).equals(Buffer.alloc(1024)));
  const dir = await mkdtemp(join(tmpdir(), 'lms-archive-unit-'));
  try {
    const path = join(dir, 'test.tar.gz');
    await writeFile(path, bytes);
    const listed = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(listed, ['manifest.json', 'submissions/student/v2/notes.txt']);
    assert.deepEqual(execFileSync('tar', ['-xOzf', path, 'manifest.json']), manifest);
    assert.deepEqual(execFileSync('tar', ['-xOzf', path, 'submissions/student/v2/notes.txt']), content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('源文件缺失字节时归档失败，不输出伪成功的部分文件', async () => {
  async function* entries(): AsyncGenerator<ArchiveEntry> {
    yield { name: 'truncated.txt', size: 20, source: Readable.from([Buffer.from('short')]) };
  }
  const archive = compressedArchive(entries());
  await assert.rejects(collect(archive.stream), /size mismatch/);
});

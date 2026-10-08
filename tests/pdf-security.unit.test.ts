import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { HttpException } from '@nestjs/common';
import { assertSafePdf } from '../apps/api/src/common/pdf-security';
import { objectStreamPdf, plainPdf } from './helpers/pdf-fixtures';

const rejected = (error: unknown) => error instanceof HttpException && error.getStatus() === 415;

test('严格 PDF 解析接受普通静态文件及压缩对象流', async () => {
  await assertSafePdf(plainPdf());
  const compressed = await objectStreamPdf();
  assert.match(compressed.toString('latin1'), /\/ObjStm/);
  await assertSafePdf(compressed);
});

test('解码 PDF 名称和引用后拒绝大小写十六进制转义的活动内容', async () => {
  for (const action of [
    '<< /S /JavaScript /JS (void 0;) >>',
    '<< /S /Java#53cript /J#53 (void 0;) >>',
    '<< /S /#4aavaScript /#4aS (void 0;) >>',
    '<< /S /Launch /F (inert-fixture) >>',
    '<< /Type /EmbeddedFile >>',
    '<< /RichMedia <<>> >>',
    '<< /XFA 5 0 R >>',
    // An overwritten dictionary entry must not hide a prohibited name.
    '<< /S /Java#53cript /S /GoTo >>',
  ])
    await assert.rejects(assertSafePdf(plainPdf([action])), rejected);
});

test('压缩对象流内的脚本对象也被解析并拒绝', async () => {
  const pdf = await objectStreamPdf(true);
  assert.doesNotMatch(pdf.toString('latin1'), /\/(?:JavaScript|JS)\b/);
  await assert.rejects(assertSafePdf(pdf), rejected);
});

test('加密、损坏、未解析引用及未知流编码均失败关闭', async () => {
  for (const pdf of [
    plainPdf(['<< /Filter /Standard /V 1 /R 2 /O (fixture) /U (fixture) /P -4 >>'], '/Encrypt 4 0 R'),
    Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'),
    plainPdf(['<< /Missing 999 0 R >>']),
    plainPdf(['<< /Length 3 /Filter /UnknownDecode >>\nstream\nabc\nendstream']),
    plainPdf(['<< /Length 3 /Filter /FlateDecode >>\nstream\nabc\nendstream']),
    plainPdf(['<<>>\ninvalid-junk']),
    Buffer.from(plainPdf().toString('latin1').replace('endobj', '')),
    Buffer.concat([plainPdf(), Buffer.from('appended garbage')]),
  ])
    await assert.rejects(assertSafePdf(pdf), rejected);
});

test('解压膨胀与深度上限在独立进程内失败关闭', async () => {
  const compressed = deflateSync(Buffer.alloc(17 * 1024 * 1024, 32));
  const stream = Buffer.concat([
    Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from('\nendstream'),
  ]);
  await assert.rejects(assertSafePdf(plainPdf([stream])), rejected);
  await assert.rejects(assertSafePdf(plainPdf(['['.repeat(129) + '0' + ']'.repeat(129)])), rejected);
  await assertSafePdf(plainPdf()); // A failed inspection releases the process slot.
});

test('解析截止时间和取消信号停止检查，并发已满立即拒绝', async () => {
  const pdf = plainPdf();
  await assert.rejects(assertSafePdf(pdf, { timeoutMs: 1 }), rejected);
  await assert.rejects(assertSafePdf(pdf, { signal: AbortSignal.abort() }), rejected);
  const controller = new AbortController();
  const cancelled = assertSafePdf(pdf, { signal: controller.signal });
  controller.abort();
  await assert.rejects(cancelled, rejected);
  const first = assertSafePdf(pdf);
  const second = assertSafePdf(pdf);
  await assert.rejects(
    assertSafePdf(pdf),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
  );
  await Promise.all([first, second]);
  await assertSafePdf(pdf);
});

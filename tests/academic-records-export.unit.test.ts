import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { academicRecordExportInput } from '../apps/api/src/academics/records-export.schemas';
import {
  AcademicExportRenderer,
  academicExportMaxBytes,
  academicLiteralBlock,
} from '../apps/api/src/academics/records-export.renderer';
import { AcademicRecordExportService } from '../apps/api/src/academics/records-export.service';
import { academicRecordQuery } from '../apps/api/src/academics/academics.schemas';
import { AuthService } from '../apps/api/src/auth/auth.service';
import type { Actor } from '../apps/api/src/auth/auth.guard';
import type { PrismaService } from '../apps/api/src/common/prisma.service';

const context = { matchedCount: 1, recordCount: 1, generatedAt: new Date('2026-10-10T00:00:00Z') };
const row = {
  id: 'record',
  moduleId: 'matrix-lab',
  title: '矩阵练习',
  status: 'COMPLETED',
  revision: 2,
  createdAt: context.generatedAt,
  updatedAt: context.generatedAt,
};

test('导出请求严格限制格式、状态、数量、未知身份字段，并与列表状态保持一致', () => {
  assert.deepEqual(academicRecordExportInput.parse({}), { format: 'csv', status: 'all' });
  for (const input of [
    { format: 'json' },
    { status: 'completed' },
    { limit: '20' },
    { limit: 0 },
    { limit: 5001 },
    { limit: 1.5 },
    { format: 'md', limit: 51 },
    { userId: 'other' },
    { organizationId: 'other' },
    { page: 1 },
    { moduleId: '' },
    { moduleId: 'x\0' },
  ])
    assert.equal(academicRecordExportInput.safeParse(input).success, false);
  assert.equal(academicRecordExportInput.safeParse({ format: 'md', limit: 50 }).success, true);
  assert.equal(academicRecordExportInput.safeParse({ format: 'csv', limit: 5000 }).success, true);
  assert.equal(academicRecordQuery.parse({ status: 'DRAFT' }).status, 'DRAFT');
  assert.equal(academicRecordQuery.parse({}).status, 'all');
});

test('CSV使用BOM和所有字段完整引用，含前导空白的公式不会作为公式打开', () => {
  for (const formula of ['=1+1', ' +SUM(A1)', '\t-2', '\r\n@evil', '\uFEFF=HYPERLINK("https://evil")']) {
    const renderer = new AcademicExportRenderer({ ...context, format: 'csv' });
    renderer.addCsv({ ...row, title: formula, summary: '第一行,"完整"\n第二行', hasNotes: true });
    const output = renderer.finish();
    assert.equal(output.buffer.subarray(0, 3).toString('hex'), 'efbbbf');
    const text = output.buffer.toString('utf8');
    assert.ok(text.includes(`"'${formula.replaceAll('"', '""')}"`));
    assert.ok(text.includes('"第一行,""完整""\n第二行"'));
    assert.ok(text.endsWith('"是"\r\n'));
    assert.equal(output.bytes, Buffer.byteLength(text));
    assert.equal(output.count, 1);
  }
});

test('Markdown动态围栏使HTML、图片链接和反向围栏保持字面文本，JSON表格图点完整保留', () => {
  const notes = '前文\n```\n![跟踪](https://example.invalid/pixel)\n<script>alert(1)</script>\n``````\n后文';
  const block = academicLiteralBlock(notes);
  assert.ok(block.startsWith('```````text\n'));
  assert.ok(block.endsWith('\n```````\n'));
  assert.equal(block.slice('```````text\n'.length, -'\n```````\n'.length), notes);
  const values = { query: 'SELECT name FROM students', payload: '`'.repeat(8) };
  const result = {
    summary: '完整结果',
    tables: [{ columns: ['数值'], rows: [{ value: 1 }] }],
    chart: { points: [{ x: 1, y: 2 }] },
  };
  const renderer = new AcademicExportRenderer({ ...context, format: 'md' });
  renderer.addMarkdown({
    ...row,
    title: notes,
    notes,
    valuesJson: JSON.stringify(values),
    resultJson: JSON.stringify(result),
  });
  const output = renderer.finish().buffer.toString('utf8');
  assert.ok(output.includes(JSON.stringify(values)));
  assert.ok(output.includes(JSON.stringify(result)));
  assert.ok(output.includes(notes));
  assert.match(output, /## 记录 1/);
  assert.match(output, /不代表答案正确性/);
});

test('最终输出逐段按UTF8字节限制，超过8MiB报413而不返回截断正文', () => {
  const renderer = new AcademicExportRenderer({ ...context, format: 'csv' });
  assert.throws(
    () =>
      renderer.addCsv({
        ...row,
        summary: '中'.repeat(Math.ceil(academicExportMaxBytes / 3)),
        hasNotes: false,
      }),
    PayloadTooLargeException,
  );
  const empty = new AcademicExportRenderer({
    ...context,
    matchedCount: 0,
    recordCount: 0,
    format: 'md',
  }).finish();
  assert.equal(empty.count, 0);
  assert.match(empty.buffer.toString('utf8'), /没有符合筛选条件/);
});

test('导出服务在数据库访问前拒绝非学生、无learning.use和practice停用', async () => {
  const actor: Actor = {
    id: 'student',
    organizationId: 'space',
    name: '学生',
    role: 'STUDENT',
    permissions: ['learning.use'],
  };
  const auth = {
    require: AuthService.prototype.require,
    checkFeature: async () => {},
  } as unknown as AuthService;
  const service = new AcademicRecordExportService({} as PrismaService, auth);
  for (const blocked of [
    { ...actor, role: 'TEACHER' },
    { ...actor, role: 'ADMIN' },
    { ...actor, permissions: [] },
  ])
    await assert.rejects(service.export(blocked, {}), ForbiddenException);
  auth.checkFeature = async () => {
    throw new ForbiddenException('停用');
  };
  await assert.rejects(service.export(actor, {}), ForbiddenException);
});

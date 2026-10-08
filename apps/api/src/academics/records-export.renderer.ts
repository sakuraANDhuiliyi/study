import { PayloadTooLargeException } from '@nestjs/common';
import { csvCell } from '../common/utils';
import { getAcademicModule } from './academics.modules';

export const academicExportMaxBytes = 8 * 1024 * 1024;
export const academicExportTooLarge = () =>
  new PayloadTooLargeException('导出文件超过8MiB，请减少导出数量或缩小模块、状态筛选范围');
export type ExportRecord = {
  id: string;
  moduleId: string;
  title: string;
  status: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};
export type CsvExportRecord = ExportRecord & { summary: string; hasNotes: boolean };
export type MarkdownExportRecord = ExportRecord & { valuesJson: string; resultJson: string; notes: string };
export type ExportContext = {
  format: 'csv' | 'md';
  matchedCount: number;
  recordCount: number;
  generatedAt: Date;
};

/** Content is literal even when it contains HTML, links or attempted closing fences. */
export function academicLiteralBlock(text: string, language = 'text') {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}${language}\n${text}\n${fence}\n`;
}

/** Incremental UTF-8 accounting prevents an oversized full export being assembled first. */
export class AcademicExportRenderer {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private count = 0;
  constructor(private readonly context: ExportContext) {
    if (context.format === 'csv')
      this.append(
        '\ufeff' +
          [
            '记录ID',
            '模块ID',
            '模块名称',
            '标题',
            '状态',
            '创建时间(UTC)',
            '更新时间(UTC)',
            '版本',
            '结果摘要',
            '有笔记',
          ]
            .map(csvCell)
            .join(',') +
          '\r\n',
      );
    else
      this.append(
        [
          '# 专业练习记录',
          '',
          `导出时间（UTC）：${context.generatedAt.toISOString()}`,
          `匹配记录：${context.matchedCount}；本次导出：${context.recordCount}。按创建时间从新到旧排列。`,
          '文件保存当前持久化的输入、结果与笔记；完成状态由学习记录维护，不代表答案正确性。',
          context.matchedCount > context.recordCount
            ? '本次按数量上限导出最新记录，未包含全部匹配记录。'
            : '',
          context.recordCount === 0 ? '没有符合筛选条件的学习记录。' : '',
          '',
        ]
          .filter((line) => line !== '')
          .join('\n\n') + '\n\n',
      );
  }
  private append(text: string) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (this.size + bytes > academicExportMaxBytes) throw academicExportTooLarge();
    this.chunks.push(Buffer.from(text, 'utf8'));
    this.size += bytes;
  }
  addCsv(row: CsvExportRecord) {
    this.append(
      [
        row.id,
        row.moduleId,
        getAcademicModule(row.moduleId)?.title ?? row.moduleId,
        row.title,
        row.status,
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
        row.revision,
        row.summary,
        row.hasNotes ? '是' : '否',
      ]
        .map(csvCell)
        .join(',') + '\r\n',
    );
    this.count++;
  }
  addMarkdown(row: MarkdownExportRecord) {
    this.count++;
    this.append(`## 记录 ${this.count}\n\n### 基本信息\n\n`);
    this.append(
      academicLiteralBlock(
        [
          `记录ID：${row.id}`,
          `标题：${row.title}`,
          `模块：${getAcademicModule(row.moduleId)?.title ?? row.moduleId}（${row.moduleId}）`,
          `状态：${row.status}`,
          `版本：${row.revision}`,
          `创建时间（UTC）：${row.createdAt.toISOString()}`,
          `更新时间（UTC）：${row.updatedAt.toISOString()}`,
        ].join('\n'),
      ),
    );
    this.append('\n### 输入参数\n\n');
    this.append(academicLiteralBlock(row.valuesJson, 'json'));
    this.append('\n### 计算结果\n\n');
    this.append(academicLiteralBlock(row.resultJson, 'json'));
    this.append('\n### 我的笔记\n\n');
    this.append(academicLiteralBlock(row.notes));
    this.append('\n');
  }
  finish() {
    return { buffer: Buffer.concat(this.chunks, this.size), bytes: this.size, count: this.count };
  }
}

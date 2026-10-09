import { PayloadTooLargeException } from '@nestjs/common';
import { csvCell } from '../common/utils';

export const auditExportMaxBytes = 8 * 1024 * 1024;
export const auditExportTooLarge = () =>
  new PayloadTooLargeException('审计导出文件超过8MiB，请减少数量或缩小筛选范围');
export type AuditExportRecord = {
  id: string;
  createdAt: Date | string;
  userId: string | null;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
};
export const auditCsvHeader =
  '\ufeff' +
  ['审计ID', '时间(UTC)', '操作人ID', '操作人名称', '操作', '资源类型', '资源标识', '追踪ID']
    .map(csvCell)
    .join(',') +
  '\r\n';

/** Quote literal cells and account for escaping and UTF-8 before allocating the final file. */
export class AuditExportRenderer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private count = 0;
  constructor() {
    this.append(auditCsvHeader);
  }
  private append(text: string) {
    const size = Buffer.byteLength(text, 'utf8');
    if (this.bytes + size > auditExportMaxBytes) throw auditExportTooLarge();
    this.chunks.push(Buffer.from(text, 'utf8'));
    this.bytes += size;
  }
  add(row: AuditExportRecord) {
    this.append(
      [
        row.id,
        new Date(row.createdAt).toISOString(),
        row.userId,
        row.actorName,
        row.action,
        row.resourceType,
        row.resourceId,
        row.requestId,
      ]
        .map(csvCell)
        .join(',') + '\r\n',
    );
    this.count++;
  }
  finish() {
    return { buffer: Buffer.concat(this.chunks, this.bytes), bytes: this.bytes, count: this.count };
  }
}

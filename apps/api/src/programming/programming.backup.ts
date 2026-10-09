import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { creativeItems } from './creative.catalog';
import { programmingFilesSchema } from './programming.schemas';

const templateIds = [
  'starter',
  'counter',
  'todo',
  'imported',
  ...creativeItems.map((item) => `creative:${item.id}`),
];
export const programmingBackupSchema = z
  .object({
    format: z.literal('zhixue-programming'),
    version: z.literal(1),
    title: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine(
        (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
        '项目名称包含不支持的控制字符',
      ),
    templateId: z.enum(templateIds as [string, ...string[]]),
    files: programmingFilesSchema,
  })
  .strict();
export type ProgrammingBackup = z.infer<typeof programmingBackupSchema>;

/** Validate portable sources and keep recognized creative attribution attached to the new project. */
export function parseProgrammingBackup(input: unknown): ProgrammingBackup {
  const backup = programmingBackupSchema.parse(input);
  const notices = backup.files.filter((file) => file.path.toLowerCase() === 'notice.txt');
  const exact = creativeItems.filter((item) => {
    const notice = item.files.find((file) => file.path === 'NOTICE.txt');
    return notice && notices.some((file) => file.content === notice.content);
  });
  const declared = backup.templateId.startsWith('creative:')
    ? creativeItems.find((item) => `creative:${item.id}` === backup.templateId)
    : undefined;
  // A repository URL alone is often ordinary documentation. Only the paired fixed
  // commit or complete original notice identifies a catalog source study.
  const markers = creativeItems.filter(
    (item) =>
      exact.some((match) => match.id === item.id) ||
      backup.files.some(
        (file) => file.content.includes(item.source.repository) && file.content.includes(item.source.commit),
      ),
  );
  if (markers.length > 1 || (declared && markers.some((item) => item.id !== declared.id)))
    throw new BadRequestException('备份包含多个创意来源，请使用完整且对应的 NOTICE.txt 与来源模板');
  const creative = declared || markers[0];
  if (!creative) return backup;
  const notice = creative.files.find((file) => file.path === 'NOTICE.txt');
  if (!notice || !backup.files.some((file) => file.path === notice.path && file.content === notice.content))
    throw new BadRequestException('创意项目备份必须完整保留对应 NOTICE.txt 中的来源归属与许可');
  if (exact.length && exact[0].id !== creative.id)
    throw new BadRequestException('创意项目的来源模板与 NOTICE.txt 不一致');
  return { ...backup, templateId: `creative:${creative.id}` };
}

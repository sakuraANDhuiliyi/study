import { z } from 'zod';

export const programmingLimits = {
  maxProjects: 20,
  maxFiles: 24,
  maxFileBytes: 65536,
  maxProjectBytes: 262144,
  maxVersions: 30,
  maxAiDrafts: 20,
} as const;

const relativeFile =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:html|css|js|json|md|txt|svg)$/;
export const programmingFilePath = z
  .string()
  .min(1)
  .max(160)
  .regex(relativeFile, '使用普通相对路径及 html/css/js/json/md/txt/svg 扩展名')
  .refine((value) => value.split('/').every((part) => part !== '.' && part !== '..'), '文件路径不能跨越目录');
const fileSchema = z
  .object({
    path: programmingFilePath,
    content: z
      .string()
      .max(programmingLimits.maxFileBytes)
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= programmingLimits.maxFileBytes,
        '每个文件最多 64 KiB',
      )
      .refine((value) => !value.includes('\0'), '源码不能包含空字符'),
  })
  .strict();
export const programmingFilesSchema = z
  .array(fileSchema)
  .min(1)
  .max(programmingLimits.maxFiles)
  .superRefine((files, context) => {
    if (!files.some((file) => file.path === 'index.html'))
      context.addIssue({ code: z.ZodIssueCode.custom, message: '项目必须保留 index.html 入口' });
    if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: '文件路径不能重复（不区分大小写）' });
    if (
      files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) >
      programmingLimits.maxProjectBytes
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: '项目源码总计最多 256 KiB' });
    if (Buffer.byteLength(JSON.stringify(files), 'utf8') > 360000)
      context.addIssue({ code: z.ZodIssueCode.custom, message: '项目内容过大，请减少文件或转义字符' });
  });
export type ProgrammingFile = z.infer<typeof fileSchema>;

const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), '文字包含不支持的控制字符');
const revision = z.number().int().min(0).max(2147483646);
export const programmingCreateInput = z
  .object({ title: text(160), templateId: z.enum(['starter', 'counter', 'todo']) })
  .strict();
export const programmingDuplicateInput = z.object({ revision, title: text(160) }).strict();
export const programmingUpdateInput = z
  .object({ revision, title: text(160), files: programmingFilesSchema })
  .strict();
export const programmingVersionInput = z.object({ revision, note: text(200).default('保存快照') }).strict();
export const programmingRestoreInput = z.object({ revision, versionId: text(100) }).strict();
export const programmingAiInput = z.object({ revision, prompt: text(3000) }).strict();
export const programmingApplyInput = z.object({ revision }).strict();
export const programmingPreviewInput = z.object({ revision, files: programmingFilesSchema }).strict();
export const programmingListQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(20).default(12),
  })
  .strict();
export const programmingModelOutput = z
  .object({
    summary: text(2000),
    plan: z.array(text(1000)).min(1).max(8),
    teaching: z.array(text(2000)).min(1).max(8),
    files: programmingFilesSchema,
  })
  .strict();
export type ProgrammingModelOutput = z.infer<typeof programmingModelOutput>;
export type ProgrammingGenerationInput = { title: string; prompt: string; files: ProgrammingFile[] };

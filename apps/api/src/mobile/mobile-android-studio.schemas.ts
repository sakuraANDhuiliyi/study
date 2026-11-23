import { z } from 'zod';
export const nativeAndroidId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const nativeAndroidPath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      path === '.' ||
      (path
        .split('/')
        .every(
          (part) =>
            /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) &&
            !['local.properties', 'key.properties', 'gradle.properties'].includes(part),
        ) &&
        !path.includes('\\')),
    '请选择项目内的普通源码文件',
  );
export const nativeAndroidFileQuery = z.object({ path: nativeAndroidPath }).strict();
export const nativeAndroidCreate = z
  .object({
    name: z.string().trim().min(1).max(50),
    package: z
      .string()
      .max(200)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
      .optional(),
  })
  .strict();
export const nativeAndroidGenerate = z
  .object({
    prompt: z.string().trim().min(1).max(20000),
    mode: z.enum(['read_only', 'workspace']).default('workspace'),
  })
  .strict();
export const nativeAndroidWrite = z
  .object({
    path: nativeAndroidPath.refine((path) => path.startsWith('app/src/'), '只可编辑 app/src 内的源码与资源'),
    content: z
      .string()
      .max(200000)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 600000, '文件超过手机编辑上限'),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const nativeAndroidEmpty = z.object({}).strict();
export const nativeAndroidApproval = z.object({ approved: z.boolean() }).strict();

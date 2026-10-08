import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({ message: '参数校验失败', fields: result.error.flatten() });
  return result.data;
}
const id = z.string().min(1).max(100);
export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const postQuerySchema = pagingSchema
  .extend({
    courseId: id.optional(),
    q: z.string().max(200).optional(),
    authorId: id.optional(),
    featured: z.enum(['true', 'false']).optional(),
    createdFrom: z.string().datetime({ offset: true }).optional(),
    createdTo: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (value) =>
      !value.createdFrom || !value.createdTo || new Date(value.createdFrom) <= new Date(value.createdTo),
    { message: '开始时间不能晚于结束时间', path: ['createdTo'] },
  );
export const messageQuerySchema = pagingSchema.extend({ afterId: id.optional() });
export const postSchema = z
  .object({
    courseId: id,
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(15000),
    attachmentIds: z.array(id).max(10).default([]),
    linkType: z.enum(['chapter', 'assignment', 'question']).optional(),
    linkId: id.optional(),
  })
  .refine((value) => Boolean(value.linkType) === Boolean(value.linkId), '关联类型和编号必须同时填写');
export const replySchema = z.object({
  body: z.string().min(1).max(15000),
  quoteReplyId: id.optional(),
  attachmentIds: z.array(id).max(10).default([]),
});
export const postUpdateSchema = z
  .object({
    pinned: z.boolean().optional(),
    featured: z.boolean().optional(),
    closed: z.boolean().optional(),
    solved: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, '至少指定一个字段');
export const sendMessageSchema = z
  .object({
    body: z.string().max(15000).default(''),
    clientId: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    attachmentIds: z.array(id).max(10).default([]),
  })
  .refine((value) => Boolean(value.body.trim()) || value.attachmentIds.length > 0, '消息内容不能为空');
export const directSchema = z.object({ userId: id });
export const readSchema = z.object({ messageId: id });
export const reportSchema = z.object({
  targetType: z.enum(['post', 'reply', 'message']),
  targetId: id,
  reason: z.string().min(3).max(1000),
});
export const moderateSchema = z.object({
  action: z.enum(['hide', 'dismiss']),
  reason: z.string().min(3).max(1000),
});
export const muteSchema = z
  .object({
    userId: id,
    courseId: id.optional(),
    classId: id.optional(),
    expiresAt: z.string().datetime(),
    reason: z.string().min(3).max(1000),
  })
  .refine((value) => !(value.courseId && value.classId), '一次只能指定课程或班级');
export const attachmentSchema = z
  .object({ courseId: id.optional(), conversationId: id.optional(), assignmentId: id.optional() })
  .refine(
    (value) => [value.courseId, value.conversationId, value.assignmentId].filter(Boolean).length <= 1,
    '文件只能归属一个业务范围',
  );
export const notificationQuerySchema = pagingSchema.extend({
  type: z.string().max(80).optional(),
  unread: z.enum(['true', 'false']).optional(),
});
export type PostInput = z.infer<typeof postSchema>;
export type PostQuery = z.infer<typeof postQuerySchema>;
export type ReplyInput = z.infer<typeof replySchema>;
export type PostUpdate = z.infer<typeof postUpdateSchema>;
export type MessageInput = z.infer<typeof sendMessageSchema>;
export type MessageQuery = z.infer<typeof messageQuerySchema>;
export type ReportInput = z.infer<typeof reportSchema>;
export type MuteInput = z.infer<typeof muteSchema>;
export type AttachmentInput = z.infer<typeof attachmentSchema>;

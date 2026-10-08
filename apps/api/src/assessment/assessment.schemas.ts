import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { cleanRichText } from '../common/utils';

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }));
const id = z.string().min(1).max(100);
const cents = z.number().int().min(0).max(100000000);
const date = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  courseId: id.optional(),
  search: text(200).optional(),
  type: z.string().max(20).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  status: z.string().max(30).optional(),
  creatorId: id.optional(),
  knowledgePoint: text(100).optional(),
  chapterId: id.optional(),
});

const content = z.object({
  type: z.enum(['single', 'multiple', 'boolean', 'blank', 'short', 'composite']),
  stem: z
    .string()
    .max(20000)
    .transform((value) => cleanRichText(value))
    .refine(
      (value) =>
        Boolean(sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()) ||
        /<img\s/.test(value),
      '题干须包含文字或有效 HTTPS 图片',
    ),
  options: z
    .array(z.object({ id: id, text: text(4000) }))
    .max(30)
    .default([]),
  answer: z.unknown().refine((value) => value !== undefined, '必须提供答案或评分参考'),
  explanation: text(20000).default(''),
  rules: z
    .object({
      partialCredit: z.boolean().default(false),
      caseSensitive: z.boolean().default(false),
      trim: z.boolean().default(true),
      collapseWhitespace: z.boolean().default(true),
    })
    .default({}),
  scoreCents: cents.refine((value) => value > 0 && value <= 1000000, '每题分值须在 0.01 至 10000 分之间'),
  difficulty: z.number().int().min(1).max(5).default(2),
  knowledgePoints: z.array(text(100)).max(30).default([]),
  tags: z.array(text(100)).max(30).default([]),
});
export const questionSchema = content.extend({
  courseId: id,
  chapterId: id.nullable().optional(),
  scope: z.enum(['private', 'shared']).default('private'),
  practiceEnabled: z.boolean().default(false),
  children: z
    .array(content.extend({ id: id }))
    .max(30)
    .default([]),
});
export const questionPatchSchema = questionSchema
  .partial()
  .extend({ active: z.boolean().optional(), expectedVersion: z.number().int().min(1) });

export const paperSchema = z.object({
  courseId: id,
  title: text(200).pipe(z.string().min(1)),
  questionVersionIds: z.array(id).max(200).default([]),
  rule: z
    .object({
      count: z.number().int().min(1).max(100),
      type: z.string().optional(),
      difficulty: z.number().int().min(1).max(5).optional(),
      knowledgePoint: text(100).optional(),
      practiceEnabled: z.boolean().optional(),
    })
    .optional(),
});
export const assignmentSchema = z.object({
  courseId: id,
  title: text(200).pipe(z.string().min(1)),
  description: text(20000).default(''),
  opensAt: date,
  dueAt: date,
  questionVersionIds: z.array(id).min(1).max(200),
  audienceIds: z.array(id).max(5000).default([]),
  allowLate: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  attachmentIds: z.array(id).max(20).default([]),
});
export const assignmentPatchSchema = assignmentSchema
  .partial()
  .extend({ revision: z.number().int().min(0), reason: text(1000).optional() });
const answerLeaf = z.union([
  z.string().max(500000),
  z.boolean(),
  // Choice count and blank count are enforced against the question snapshot;
  // total serialized answers retain the existing 500 KB service limit.
  z.array(z.string().max(500000)),
  z.null(),
]);
// Composite questions submit a map of child IDs to ordinary answers; arbitrary
// JSON objects and further nesting have no supported answer representation.
const answerValue = z.union([
  answerLeaf,
  z.record(id, answerLeaf).refine((value) => Object.keys(value).length <= 30, '综合题答案过多'),
]);
export const answerSchema = z.object({
  questionVersionId: id,
  value: answerValue,
});
export const submissionSchema = z.object({
  answers: z.array(answerSchema).max(200),
  attachmentIds: z.array(id).max(20).default([]),
  idempotencyKey: z.string().min(8).max(128),
});
export const draftSchema = submissionSchema
  .omit({ idempotencyKey: true })
  .extend({ revision: z.number().int().min(0) });
export const gradeSchema = z.object({
  revision: z.number().int().min(0),
  items: z
    .array(z.object({ questionVersionId: id, scoreCents: cents, comment: text(10000).default('') }))
    .max(200),
  comment: text(10000).default(''),
  finalize: z.boolean().default(true),
});
// Omitting overall exam feedback during per-question marking preserves the last feedback.
export const examGradeSchema = gradeSchema.extend({ comment: text(10000).optional() });
export const exceptionSchema = z.object({
  userId: id,
  reason: text(2000).pipe(z.string().min(3)),
  allowUntil: date.optional(),
  extraAttempts: z.number().int().min(0).max(20).default(0),
  exempt: z.boolean().default(false),
});
export const returnSchema = z.object({ reason: text(2000).pipe(z.string().min(3)) });
export const practiceSchema = z.object({
  courseId: id,
  count: z.number().int().min(1).max(100).optional(),
  mode: z.enum(['random', 'mistakes', 'favorites']).default('random'),
  questionIds: z.array(id).max(100).optional(),
  knowledgePoint: text(100).optional(),
  type: z.string().max(20).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  chapterId: id.optional(),
});
export const practiceProgressSchema = z.object({
  revision: z.number().int().min(0),
  flags: z.array(id).max(100),
  currentPosition: z.number().int().min(0).max(99),
});
export const examSchema = z.object({
  courseId: id,
  title: text(200).pipe(z.string().min(1)),
  description: text(20000).default(''),
  startsAt: date,
  endsAt: date,
  entryClosesAt: date,
  durationMinutes: z.number().int().min(1).max(1440),
  questionVersionIds: z.array(id).min(1).max(200),
  audienceIds: z.array(id).max(5000).default([]),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  allowBacktrack: z.boolean().default(true),
  passCents: cents,
  graderIds: z.array(id).max(30).default([]),
  scoreReleaseAt: date.nullable().optional(),
  answerReleaseAt: date.nullable().optional(),
  explanationReleaseAt: date.nullable().optional(),
  commentReleaseAt: date.nullable().optional(),
  appealDeadline: date.nullable().optional(),
});
export const examPatchSchema = examSchema.partial().extend({ revision: z.number().int().min(0) });
export const saveSchema = z.object({
  revision: z.number().int().min(0),
  answers: z.array(answerSchema).max(200),
  flags: z.array(id).max(200).optional(),
  currentPosition: z.number().int().min(0).max(199).optional(),
});
export const submitExamSchema = z.object({ idempotencyKey: z.string().min(8).max(128) });
export const extensionSchema = z.object({
  userId: id,
  reason: text(2000).pipe(z.string().min(3)),
  deadlineAt: date,
  extraAttempts: z.number().int().min(0).max(10).default(0),
});
export const appealSchema = z.object({ reason: text(4000).pipe(z.string().min(5)) });
export const resolveSchema = z.object({
  resolution: text(4000).pipe(z.string().min(5)),
  scoreCents: cents.optional(),
});
export const eligibilitySchema = z.object({
  userId: id,
  eligible: z.boolean(),
  reason: text(2000).pipe(z.string().min(3)),
});
export type QuestionInput = z.infer<typeof questionSchema>;

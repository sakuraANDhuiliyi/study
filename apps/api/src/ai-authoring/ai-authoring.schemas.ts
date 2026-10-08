import { z } from 'zod';
import { questionSchema, type QuestionInput } from '../assessment/assessment.schemas';

// Authoring uses plain text only; generated HTML and external image loads are never accepted.
const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), '文本包含无效控制字符')
    .refine(
      (value) => !/<(?:\/?[a-z]|!|\?)/i.test(value),
      '请使用纯文本，不要包含HTML标签或注释；比较符号后请留空格',
    );
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const authoringTypes = ['single', 'multiple', 'boolean', 'blank', 'short'] as const;
const questionType = z.enum(authoringTypes);
const score = z.number().int().min(1).max(1000000);
const difficulty = z.number().int().min(1).max(5);
const blueprintItem = z
  .object({
    type: questionType,
    count: z.number().int().min(1).max(10),
    scoreCents: score,
    difficulty,
  })
  .strict();

export const authoringGenerateInput = z
  .object({
    mode: z.enum(['questions', 'paper']),
    courseId: id,
    chapterId: id.nullable().optional(),
    title: text(200, 1),
    knowledgePoints: z.array(text(100, 1)).min(1).max(20),
    requirements: text(2000).default(''),
    material: text(10000).default(''),
    blueprint: z.array(blueprintItem).min(1).max(5),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.blueprint.reduce((count, item) => count + item.count, 0) > 10)
      context.addIssue({ code: 'custom', path: ['blueprint'], message: '一次最多生成10道题目' });
    if (new Set(input.blueprint.map((item) => item.type)).size !== input.blueprint.length)
      context.addIssue({ code: 'custom', path: ['blueprint'], message: '每种题型只能设置一次' });
    if (new Set(input.knowledgePoints).size !== input.knowledgePoints.length)
      context.addIssue({ code: 'custom', path: ['knowledgePoints'], message: '知识点不能重复' });
  });
export type AuthoringGenerateInput = z.infer<typeof authoringGenerateInput>;

// One answer representation works across the model contract, preview editor and commit validation.
export const authoringContentSchema = z
  .object({
    type: questionType,
    stem: text(8000, 1),
    options: z.array(z.object({ id: z.string().regex(/^[A-H]$/), text: text(1000, 1) }).strict()).max(8),
    answer: z.array(text(2000, 1)).min(1).max(10),
    explanation: text(8000, 1),
    knowledgePoints: z.array(text(100, 1)).min(1).max(20),
  })
  .strict();
type Content = z.infer<typeof authoringContentSchema>;
function validateContent(question: Content, context: z.RefinementCtx) {
  const invalid = (message: string, path = 'answer') =>
    context.addIssue({ code: 'custom', path: [path], message });
  const options = question.options.map((item) => item.id);
  if (escapeHtml(question.stem).replace(/\n/g, '<br>').length + 7 > 20000)
    invalid('题干转换后过长，请减少特殊符号或换行', 'stem');
  if (new Set(options).size !== options.length) invalid('选项编号不能重复', 'options');
  if (question.type === 'single' || question.type === 'multiple') {
    if (options.length < 2) invalid('选择题至少需要两个选项', 'options');
    if (new Set(question.options.map((item) => item.text)).size !== options.length)
      invalid('选项内容不能重复', 'options');
    if (question.answer.some((answer) => !options.includes(answer))) invalid('答案必须是有效选项编号');
    if (new Set(question.answer).size !== question.answer.length) invalid('答案选项不能重复');
    if (question.type === 'single' && question.answer.length !== 1) invalid('单选题必须只有一个正确选项');
    if (question.type === 'multiple' && question.answer.length < 2) invalid('多选题至少需要两个正确选项');
  } else {
    if (options.length) invalid('此题型不能包含选择题选项', 'options');
    if (
      question.type === 'boolean' &&
      (question.answer.length !== 1 || !['true', 'false'].includes(question.answer[0]))
    )
      invalid('判断题答案必须为true或false');
    if (question.type === 'short' && question.answer.length !== 1) invalid('简答题需要一项参考答案');
    if (question.type === 'blank') {
      const blanks = question.stem.match(/_{3,}/g) || [];
      if (blanks.length !== question.answer.length)
        invalid('填空题用___标记每一空，空位数量必须与答案数量一致');
    }
  }
}
export const authoringQuestionSchema = authoringContentSchema
  .extend({ scoreCents: score, difficulty })
  .superRefine(validateContent);
export type AuthoringQuestion = z.infer<typeof authoringQuestionSchema>;
export const authoringModelOutput = z
  .object({
    title: text(200, 1),
    questions: z.array(authoringContentSchema.superRefine(validateContent)).min(1).max(10),
  })
  .strict();

export const authoringCommitInput = z
  .object({
    revision: z.number().int().min(0),
    title: text(200, 1),
    questions: z.array(authoringQuestionSchema).min(1).max(10),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.questions.map((q) => q.stem.replace(/\s+/g, '').normalize('NFKC'))).size !==
      input.questions.length
    )
      context.addIssue({ code: 'custom', path: ['questions'], message: '不能保存题干完全重复的题目' });
  });
export const authoringListQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function toQuestionInput(
  value: AuthoringQuestion,
  courseId: string,
  chapterId?: string | null,
): QuestionInput {
  const question = authoringQuestionSchema.parse(value);
  let answer: unknown = question.answer;
  if (question.type === 'single' || question.type === 'short') answer = question.answer[0];
  if (question.type === 'boolean') answer = question.answer[0] === 'true';
  if (question.type === 'blank') answer = question.answer.map((item) => [item]);
  const result = questionSchema.parse({
    ...question,
    stem: '<p>' + escapeHtml(question.stem).replace(/\n/g, '<br>') + '</p>',
    answer,
    courseId,
    chapterId: chapterId || null,
    scope: 'private',
    practiceEnabled: false,
    tags: ['AI辅助'],
    children: [],
  });
  // These fields are plain-text React output. Preserve comparison signs and ampersands
  // instead of displaying the existing rich-text sanitizer's HTML entities literally.
  return {
    ...result,
    options: question.options,
    explanation: question.explanation,
    knowledgePoints: question.knowledgePoints,
  };
}

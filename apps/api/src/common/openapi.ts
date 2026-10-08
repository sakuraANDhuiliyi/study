import { z } from 'zod';
import type { OpenAPIObject } from '@nestjs/swagger';
import * as a from '../assessment/assessment.schemas';
import * as c from '../communication/communication.schemas';
import * as academic from '../academics/academics.schemas';
import { courseInput, lessonInput } from '../courses/courses.controller';
import { newUser } from '../admin/admin.controller';
import {
  registrationSchema,
  profileSchema,
  joinRequestSchema,
  joinReviewSchema,
} from '../accounts/accounts.schemas';
import { taskInput, taskPatch, taskDelete } from '../planner/planner.schemas';
import { noteInput } from '../notes/notes.controller';
import { createAiReportInput, searchAiReportInput } from '../ai-study/ai-study.schemas';
import { authoringGenerateInput, authoringCommitInput } from '../ai-authoring/ai-authoring.schemas';
import {
  algorithmAnalysisInput,
  algorithmDraftInput,
  algorithmSubmissionInput,
  algorithmLearningInput,
} from '../algorithms/algorithms.schemas';
function schema(value: z.ZodTypeAny): any {
  const d = value._def as any;
  if (['ZodEffects', 'ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodCatch'].includes(d.typeName)) {
    const base = schema(d.schema || d.innerType);
    if (d.typeName === 'ZodNullable') base.nullable = true;
    if (d.typeName === 'ZodDefault') base.default = d.defaultValue();
    return base;
  }
  if (d.typeName === 'ZodObject') {
    const shape = d.shape();
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(shape).map(([key, v]) => [key, schema(v as z.ZodTypeAny)]),
      ),
      required: Object.entries(shape)
        .filter(([, v]) => !(v as z.ZodTypeAny).isOptional())
        .map(([k]) => k),
      additionalProperties: d.unknownKeys === 'passthrough',
    };
  }
  if (d.typeName === 'ZodString') {
    const out: any = { type: 'string' };
    for (const check of d.checks || []) {
      if (check.kind === 'min') out.minLength = check.value;
      if (check.kind === 'max') out.maxLength = check.value;
      if (check.kind === 'datetime') out.format = 'date-time';
      if (check.kind === 'url') out.format = 'uri';
      if (check.kind === 'regex') out.pattern = check.regex.source;
    }
    return out;
  }
  if (d.typeName === 'ZodNumber') {
    const out: any = { type: d.checks.some((c: any) => c.kind === 'int') ? 'integer' : 'number' };
    for (const check of d.checks || []) {
      if (check.kind === 'min') out.minimum = check.value;
      if (check.kind === 'max') out.maximum = check.value;
    }
    return out;
  }
  if (d.typeName === 'ZodBoolean') return { type: 'boolean' };
  if (d.typeName === 'ZodRecord') return { type: 'object', additionalProperties: schema(d.valueType) };
  if (d.typeName === 'ZodEnum') return { type: 'string', enum: d.values };
  if (d.typeName === 'ZodArray')
    return {
      type: 'array',
      items: schema(d.type),
      ...(d.minLength ? { minItems: d.minLength.value } : {}),
      ...(d.maxLength ? { maxItems: d.maxLength.value } : {}),
    };
  return {};
}
export function enrichOpenAPI(doc: OpenAPIObject) {
  const map: [string, string, z.ZodTypeAny][] = [
    ['post', '/ai-authoring/drafts', authoringGenerateInput],
    ['post', '/ai-authoring/drafts/{id}/commit', authoringCommitInput],
    ['post', '/ai-study/reports', createAiReportInput],
    ['patch', '/academics/preferences', academic.academicPreferencesInput],
    ['post', '/academics/modules/{id}/evaluate', academic.academicEvaluationInput],
    ['patch', '/academics/records/{id}', academic.academicRecordPatch],
    ['post', '/academics/admin/subjects', academic.academicSubjectCreate],
    ['patch', '/academics/admin/subjects/{id}', academic.academicSubjectPatch],
    ['post', '/academics/admin/majors', academic.academicMajorCreate],
    ['patch', '/academics/admin/majors/{id}', academic.academicMajorPatch],
    ['put', '/algorithms/problems/{id}/draft', algorithmDraftInput],
    ['patch', '/algorithms/problems/{id}/learning', algorithmLearningInput],
    ['post', '/algorithms/problems/{id}/submissions', algorithmSubmissionInput],
    ['post', '/algorithms/problems/{id}/analysis', algorithmAnalysisInput],
    ['post', '/ai-study/reports/{id}/search', searchAiReportInput],
    ['post', '/planner/tasks', taskInput],
    ['patch', '/planner/tasks/{id}', taskPatch],
    ['delete', '/planner/tasks/{id}', taskDelete],
    ['put', '/lessons/{id}/note', noteInput],
    [
      'delete',
      '/lessons/{id}/note',
      z.object({ revision: z.number().int().min(1), noteId: z.string().min(1).max(100) }),
    ],
    ['post', '/auth/login', z.object({ username: z.string(), password: z.string() })],
    ['post', '/auth/register', registrationSchema],
    ['post', '/account/join-requests', joinRequestSchema],
    ['post', '/account/join-requests/{id}/cancel', z.object({}).strict()],
    ['post', '/account/leave-organization', z.object({}).strict()],
    ['patch', '/admin/join-settings', z.object({ joinEnabled: z.boolean() }).strict()],
    ['post', '/admin/join-settings/rotate-code', z.object({}).strict()],
    ['patch', '/admin/join-requests/{id}', joinReviewSchema],
    ['post', '/auth/recovery-code', z.object({ oldPassword: z.string().min(1).max(128) }).strict()],
    [
      'post',
      '/auth/recover',
      z
        .object({
          username: z.string().min(3).max(64),
          code: z.string().min(1).max(200),
          newPassword: z.string().min(12).max(128),
        })
        .strict(),
    ],
    ['post', '/auth/role', z.object({ role: z.enum(['STUDENT', 'TEACHER', 'ADMIN', 'SUPER_ADMIN']) })],
    ['patch', '/auth/profile', profileSchema],
    [
      'post',
      '/auth/password',
      z.object({ oldPassword: z.string(), newPassword: z.string().min(12).max(128) }),
    ],
    ['post', '/courses', courseInput],
    ['patch', '/courses/{id}', courseInput.partial()],
    ['post', '/chapters/{id}/lessons', lessonInput],
    ['patch', '/lessons/{id}', lessonInput.partial()],
    ['post', '/courses/{id}/chapters', z.object({ title: z.string(), sortOrder: z.number().optional() })],
    [
      'put',
      '/lessons/{id}/progress',
      z.object({ completed: z.boolean(), positionSeconds: z.number().int().min(0).optional() }),
    ],
    ['post', '/courses/{id}/members', z.object({ userId: z.string(), kind: z.enum(['teacher', 'student']) })],
    ['post', '/admin/users', newUser],
    [
      'patch',
      '/admin/users/{id}',
      newUser.omit({ username: true, password: true }).partial().extend({ active: z.boolean().optional() }),
    ],
    ['post', '/admin/users/import', z.object({ rows: z.array(newUser), commit: z.boolean().default(false) })],
    [
      'post',
      '/admin/grants',
      z.object({
        userId: z.string(),
        permissionId: z.string(),
        expiresAt: z.string().datetime(),
        reason: z.string().min(5),
      }),
    ],
    ['post', '/questions', a.questionSchema],
    ['patch', '/questions/{id}', a.questionPatchSchema],
    [
      'post',
      '/questions/import',
      z.object({ rows: z.array(a.questionSchema), commit: z.boolean().default(false) }),
    ],
    ['post', '/papers', a.paperSchema],
    ['post', '/assignments', a.assignmentSchema],
    ['patch', '/assignments/{id}', a.assignmentPatchSchema],
    ['put', '/assignments/{id}/draft', a.draftSchema],
    ['post', '/assignments/{id}/submit', a.submissionSchema],
    ['post', '/assignments/{id}/exceptions', a.exceptionSchema],
    ['put', '/submissions/{id}/grade', a.gradeSchema],
    ['post', '/submissions/{id}/return', a.returnSchema],
    ['post', '/practice', a.practiceSchema],
    ['post', '/practice/{id}/answer', a.answerSchema],
    ['put', '/practice/{id}/progress', a.practiceProgressSchema],
    ['post', '/exams', a.examSchema],
    ['patch', '/exams/{id}', a.examPatchSchema],
    ['post', '/exams/{id}/extensions', a.extensionSchema],
    ['put', '/exams/{id}/eligibility', a.eligibilitySchema],
    ['put', '/attempts/{id}/answers', a.saveSchema],
    ['post', '/attempts/{id}/submit', a.submitExamSchema],
    ['put', '/attempts/{id}/grade', a.examGradeSchema],
    ['post', '/attempts/{id}/appeals', a.appealSchema],
    ['post', '/appeals/{id}/resolve', a.resolveSchema],
    ['post', '/communication/posts', c.postSchema],
    ['patch', '/communication/posts/{id}', c.postUpdateSchema],
    ['post', '/communication/posts/{id}/replies', c.replySchema],
    ['post', '/communication/conversations', c.directSchema],
    ['post', '/communication/conversations/{id}/messages', c.sendMessageSchema],
    ['post', '/communication/conversations/{id}/read', c.readSchema],
    ['post', '/communication/reports', c.reportSchema],
    ['post', '/communication/reports/{id}/resolve', c.moderateSchema],
    ['post', '/communication/mutes', c.muteSchema],
  ];
  for (const [method, path, s] of map) {
    const op = (doc.paths['/api' + path] as any)?.[method];
    if (op) op.requestBody = { required: true, content: { 'application/json': { schema: schema(s) } } };
  }
  for (const path of [
    '/courses',
    '/questions',
    '/assignments',
    '/exams',
    '/exams/{id}/questions/{questionVersionId}/answers',
    '/courses/{id}/members',
    '/practice',
    '/mistakes',
    '/favorites',
    '/papers',
    '/admin/users',
    '/admin/classes',
    '/admin/terms',
    '/admin/audit',
    '/admin/jobs',
    '/notifications',
    '/communication/posts',
    '/communication/conversations',
  ]) {
    const op = doc.paths['/api' + path]?.get;
    if (op)
      op.parameters = [
        ...(op.parameters || []),
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ];
  }
  for (const path of [
    '/api/ai-study/reports',
    '/api/ai-authoring/drafts',
    '/api/algorithms/problems',
    '/api/algorithms/problems/{id}/submissions',
  ]) {
    const operation = doc.paths[path]?.get;
    if (operation)
      operation.parameters = [
        ...(operation.parameters || []),
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
        {
          in: 'query',
          name: 'pageSize',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 50,
            default: path.startsWith('/api/algorithms/') ? 20 : 10,
          },
        },
      ];
  }
  const algorithmList = doc.paths['/api/algorithms/problems']?.get;
  if (algorithmList)
    algorithmList.parameters = [
      ...(algorithmList.parameters || []),
      { in: 'query', name: 'q', schema: { type: 'string', maxLength: 100 } },
      { in: 'query', name: 'favorite', schema: { type: 'string', enum: ['true', 'false'] } },
      { in: 'query', name: 'review', schema: { type: 'string', enum: ['review', 'mastered'] } },
      { in: 'query', name: 'difficulty', schema: { type: 'string', enum: ['easy', 'medium', 'hard'] } },
      { in: 'query', name: 'tag', schema: { type: 'string', maxLength: 60 } },
      { in: 'query', name: 'status', schema: { type: 'string', enum: ['todo', 'attempted', 'solved'] } },
    ];
  const aiExport = doc.paths['/api/ai-study/reports/{id}/export']?.get;
  const academicRecords = doc.paths['/api/academics/records']?.get;
  if (academicRecords)
    academicRecords.parameters = [
      ...(academicRecords.parameters || []),
      { in: 'query', name: 'moduleId', schema: { type: 'string', maxLength: 100 } },
      { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
      { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 20, default: 12 } },
    ];
  if (aiExport)
    aiExport.parameters = [
      ...(aiExport.parameters || []),
      { in: 'query', name: 'format', schema: { type: 'string', enum: ['md', 'json'], default: 'md' } },
    ];
  return doc;
}

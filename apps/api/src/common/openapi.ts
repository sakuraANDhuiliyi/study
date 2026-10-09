import { z } from 'zod';
import type { OpenAPIObject } from '@nestjs/swagger';
import * as a from '../assessment/assessment.schemas';
import * as c from '../communication/communication.schemas';
import * as academic from '../academics/academics.schemas';
import * as goals from '../academics/goals.schemas';
import { academicRecordExportInput } from '../academics/records-export.schemas';
import * as programming from '../programming/programming.schemas';
import { programmingBackupSchema } from '../programming/programming.backup';
import * as training from '../algorithms/training-plan.schemas';
import * as creative from '../programming/creative.schemas';
import * as forum from '../algorithm-forum/algorithm-forum.schemas';
import { courseInput, lessonInput } from '../courses/courses.controller';
import { newUser } from '../admin/admin.controller';
import {
  registrationSchema,
  profileSchema,
  joinRequestSchema,
  joinReviewSchema,
} from '../accounts/accounts.schemas';
import { taskInput, taskPatch, taskDelete } from '../planner/planner.schemas';
import { learningActionsQuery } from '../planner/actions.schemas';
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
  if (d.typeName === 'ZodLiteral')
    return {
      type: typeof d.value === 'number' && Number.isInteger(d.value) ? 'integer' : typeof d.value,
      enum: [d.value],
    };
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
    ['post', '/algorithms/training-plans', training.trainingPlanCreate],
    ['patch', '/algorithms/training-plans/{id}', training.trainingPlanPatch],
    ['delete', '/algorithms/training-plans/{id}', training.trainingPlanDelete],
    ['post', '/algorithm-forum/posts', forum.forumPostInput],
    ['patch', '/algorithm-forum/posts/{id}', forum.forumPostUpdateInput],
    ['delete', '/algorithm-forum/posts/{id}', forum.forumRevisionInput],
    ['patch', '/algorithm-forum/posts/{id}/moderation', forum.forumModerationInput],
    ['post', '/algorithm-forum/posts/{id}/replies', forum.forumReplyInput],
    ['delete', '/algorithm-forum/posts/{postId}/replies/{id}', forum.forumRevisionInput],
    ['put', '/programming/creative/{id}/favorite', creative.creativeFavoriteInput],
    ['post', '/programming/creative/{id}/preview', creative.creativeRevisionInput],
    ['post', '/programming/creative/{id}/projects', creative.creativeProjectInput],
    ['post', '/programming/projects', programming.programmingCreateInput],
    ['post', '/programming/projects/import', programmingBackupSchema],
    ['post', '/programming/projects/{id}/duplicate', programming.programmingDuplicateInput],
    ['patch', '/programming/projects/{id}', programming.programmingUpdateInput],
    ['post', '/programming/projects/{id}/versions', programming.programmingVersionInput],
    ['post', '/programming/projects/{id}/restore', programming.programmingRestoreInput],
    ['post', '/programming/projects/{id}/preview', programming.programmingPreviewInput],
    ['post', '/programming/projects/{id}/ai-drafts', programming.programmingAiInput],
    ['post', '/programming/projects/{id}/ai-drafts/{draftId}/apply', programming.programmingApplyInput],
    ['post', '/ai-authoring/drafts', authoringGenerateInput],
    ['post', '/ai-authoring/drafts/{id}/commit', authoringCommitInput],
    ['post', '/ai-study/reports', createAiReportInput],
    ['patch', '/academics/preferences', academic.academicPreferencesInput],
    ['post', '/academics/goals', goals.academicGoalCreate],
    ['post', '/academics/records/export', academicRecordExportInput],
    ['patch', '/academics/goals/{id}', goals.academicGoalPatch],
    ['delete', '/academics/goals/{id}', goals.academicGoalDelete],
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
  const programmingList = doc.paths['/api/programming/projects']?.get;
  const learningActions = doc.paths['/api/planner/actions']?.get;
  if (learningActions)
    learningActions.description =
      '仅学生且具有 learning.use 权限；课程任务另需 course.read、当前机构有效课程授权及本人受众资格。按实际本人截止和最新正式提交判定，草稿不当作提交。逾期包括今天已过截止；今天为服务器当前时间至上海明日零点；未来7日为上海明日起七个自然日，右边界不含。每桶独立分页并返回同一查询快照的完整匹配总数；未完成但关闭提交的作业仅可查看，不能直接提交。';
  const trainingList = doc.paths['/api/algorithms/training-plans']?.get;
  if (trainingList)
    trainingList.description =
      '返回本人当前学习空间最多20份私人计划、公开题目摘要及配额。进度取本空间本人正式提交通过的题目，包含创建计划前已通过的题目，样例和自定义运行不计入。';
  const programmingBackup = doc.paths['/api/programming/projects/{id}/backup']?.get;
  if (programmingBackup)
    programmingBackup.description =
      '下载格式为 zhixue-programming、版本为1的 JSON 项目备份，仅含名称、模板标识与源码文件，不含用户身份、历史、AI候选或预览凭据；可导入为独立新项目。';
  const programmingDraftList = doc.paths['/api/programming/projects/{id}/ai-drafts']?.get;
  if (programmingDraftList)
    programmingDraftList.description =
      '返回最多 20 条候选摘要，不含源码 files；查看单条候选详情时获取源码。仅存在 pending 候选时需要轮询。';
  const algorithmDraft = doc.paths['/api/algorithms/problems/{id}/draft']?.put;
  if (algorithmDraft) {
    algorithmDraft.description =
      '必须携带最近读取的 revision；尚无云端草稿时使用 0。成功返回新 revision，旧版本返回 409，缺少版本返回 400。冲突后应先比较云端与本地内容，再由用户选择保存。';
    algorithmDraft.responses['409'] = { description: '草稿已更新；本次写入未覆盖云端内容' };
  }
  const academicEvaluation = doc.paths['/api/academics/modules/{id}/evaluate']?.post;
  if (academicEvaluation)
    academicEvaluation.description =
      '计算前原子预占每账号 20 次/分钟、200 次/滚动 24 小时及可配置来源 IP 分钟配额；失败尝试也计入，删除记录或切换学习空间不返还次数。';
  if (programmingList)
    programmingList.parameters = [
      ...(programmingList.parameters || []),
      { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
      { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 20, default: 12 } },
    ];
  const creativeList = doc.paths['/api/programming/creative']?.get;
  if (creativeList)
    creativeList.parameters = [
      { in: 'query', name: 'q', schema: { type: 'string', maxLength: 100 } },
      { in: 'query', name: 'category', schema: { type: 'string', maxLength: 64 } },
      { in: 'query', name: 'collection', schema: { type: 'string', enum: ['all', 'saved'], default: 'all' } },
      {
        in: 'query',
        name: 'edition',
        schema: { type: 'string', enum: ['all', 'new', 'foundation'], default: 'all' },
      },
      { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
      { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 24, default: 12 } },
    ];
  for (const [path, query] of [
    ['/api/planner/actions', learningActionsQuery],
    ['/api/algorithm-forum/posts', forum.forumListQuery],
    ['/api/algorithm-forum/posts/{id}/replies', forum.forumPageQuery],
  ] as const) {
    const operation = doc.paths[path]?.get;
    if (!operation) continue;
    const querySchema = schema(query);
    operation.parameters = [
      ...(operation.parameters || []).filter((parameter) => !('in' in parameter) || parameter.in !== 'query'),
      ...Object.entries(querySchema.properties).map(([name, value]) => ({
        in: 'query' as const,
        name,
        required: querySchema.required.includes(name),
        schema: value as any,
        ...(name === 'scope'
          ? {
              description:
                'public 为全站已登录用户的公共社区；organization 仅当前学校 / 机构。个人空间不支持 organization。',
            }
          : {}),
      })),
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
  const recordExport = doc.paths['/api/academics/records/export']?.post;
  const academicRecords = doc.paths['/api/academics/records']?.get;
  const academicGoals = doc.paths['/api/academics/goals']?.get;
  if (academicGoals)
    academicGoals.parameters = [
      ...(academicGoals.parameters || []),
      {
        in: 'query',
        name: 'status',
        schema: { type: 'string', enum: ['active', 'archived', 'all'], default: 'active' },
      },
    ];
  if (academicRecords)
    academicRecords.parameters = [
      ...(academicRecords.parameters || []),
      { in: 'query', name: 'moduleId', schema: { type: 'string', maxLength: 100 } },
      {
        in: 'query',
        name: 'status',
        schema: { type: 'string', enum: ['all', 'DRAFT', 'COMPLETED'], default: 'all' },
      },
      { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } },
      { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 20, default: 12 } },
    ];
  if (recordExport)
    recordExport.responses = {
      '200': {
        description: '当前空间本人已保存的学习记录附件；按创建时间倒序，最多返回请求的 limit 条',
        headers: {
          'Content-Disposition': { schema: { type: 'string' }, description: '服务器生成的安全附件文件名' },
          'X-Export-Matched-Count': { schema: { type: 'integer' }, description: '符合当前筛选的记录总数' },
          'X-Export-Record-Count': { schema: { type: 'integer' }, description: '文件包含的实际记录条数' },
          'X-Export-Truncated': {
            schema: { type: 'string', enum: ['true', 'false'] },
            description: '是否仅包含匹配记录中最新的 limit 条；不截断单条正文',
          },
        },
        content: {
          'text/csv': { schema: { type: 'string', format: 'binary' } },
          'text/markdown': { schema: { type: 'string', format: 'binary' } },
        },
      },
      '413': { description: '完整文件超过 8 MiB，请缩小数量或筛选范围' },
      '429': { description: '本人当前空间一分钟内已成功导出 5 次，请稍后重试' },
    };
  if (aiExport)
    aiExport.parameters = [
      ...(aiExport.parameters || []),
      { in: 'query', name: 'format', schema: { type: 'string', enum: ['md', 'json'], default: 'md' } },
    ];
  return doc;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileTeachingToolsRouteAllowed as allowed } from '../apps/api/src/mobile/mobile-teaching-tools.policy';
import {
  mobileAnnouncementInput,
  mobileAnnouncementQuery,
  mobileAnalyticsQuery,
  mobileAnalyticsExportQuery,
  mobileAuthoringListQuery,
} from '../apps/api/src/mobile/mobile-teaching-tools.schemas';
import { authoringCommitInput } from '../apps/api/src/ai-authoring/ai-authoring.schemas';
import {
  commitAuthoringQuestions,
  editAuthoringQuestion,
  type AuthoringQuestion,
} from '../apps/mobile/src/ai-authoring-model';
import {
  nativeAnalyticsResult,
  type LearningAnalyticsData,
} from '../apps/mobile/src/learning-analytics-model';
test('teaching tools allow only bounded authoring, analytics and course announcement routes', () => {
  for (const [method, paths] of Object.entries({
    GET: [
      'analytics',
      'analytics/filters',
      'analytics/export',
      'ai-authoring/status',
      'ai-authoring/drafts',
      'ai-authoring/drafts/a',
      'teaching-announcements',
    ],
    POST: ['ai-authoring/drafts', 'ai-authoring/drafts/a/commit', 'teaching-announcements'],
    DELETE: ['ai-authoring/drafts/a'],
  }))
    for (const path of paths) assert.ok(allowed('/api/mobile/' + path, method));
  for (const path of [
    '/api/analytics',
    '/api/mobile/ai-authoring/config',
    '/api/mobile/ai-authoring/drafts/a/commit/other',
    '/api/mobile/analytics/users/a',
    '/api/mobile/teaching-announcements/a',
  ])
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal(allowed(path, method), false);
  assert.equal(mobileAnalyticsQuery.safeParse({ userId: 'other' }).success, false);
  assert.equal(mobileAnalyticsQuery.safeParse({ courseId: ['a'] }).success, false);
  assert.equal(mobileAnalyticsExportQuery.safeParse({ format: 'anything' }).success, false);
  assert.equal(mobileAuthoringListQuery.safeParse({ page: true }).success, false);
  assert.equal(mobileAuthoringListQuery.safeParse({ pageSize: 21 }).success, false);
  assert.equal(mobileAnnouncementInput.safeParse({ title: '公告', content: '内容' }).success, false);
  assert.equal(
    mobileAnnouncementInput.safeParse({
      courseId: 'c',
      title: '公告',
      content: '内容',
      organizationId: 'other',
    }).success,
    false,
  );
  assert.equal(mobileAnnouncementQuery.safeParse({ courseId: 'c', page: ['1'] }).success, false);
});
const single: AuthoringQuestion = {
  type: 'single',
  stem: '2 + 2 等于多少？',
  options: [
    { id: 'A', text: '4' },
    { id: 'B', text: '5' },
  ],
  answer: ['A'],
  explanation: '两个2相加得到4。',
  knowledgePoints: ['整数加法'],
  scoreCents: 200,
  difficulty: 2,
};
test('native review controls serialize five actual question types to valid server commits', () => {
  const questions: AuthoringQuestion[] = [
    single,
    {
      ...single,
      type: 'multiple',
      stem: '选择与2 + 2相等的表达式',
      options: [
        { id: 'A', text: '4' },
        { id: 'B', text: '1 + 3' },
        { id: 'C', text: '5' },
      ],
      answer: ['A', 'B'],
    },
    { ...single, type: 'boolean', stem: '2 + 2 = 4', options: [], answer: ['true'] },
    { ...single, type: 'blank', stem: '2 + 2 = ___', options: [], answer: ['4'] },
    {
      ...single,
      type: 'short',
      stem: '说明2 + 2为什么等于4',
      options: [],
      answer: ['把两组各2个物体合并，共4个。'],
    },
  ];
  const edits = questions.map(editAuthoringQuestion);
  edits[0].scoreText = '0.29';
  edits[0].explanation = '经教师逐题核对后的解析';
  const output = commitAuthoringQuestions(edits);
  assert.equal(output[0].scoreCents, 29);
  assert.equal(output[0].explanation, edits[0].explanation);
  assert.deepEqual(output[3].answer, ['4']);
  assert.deepEqual(output[4].answer, questions[4].answer);
  assert.equal(
    authoringCommitInput.safeParse({ revision: 1, title: '审阅后的草稿', questions: output }).success,
    true,
  );
});
test('invalid score/answer/duplicate review cannot silently become an accepted commit', () => {
  const edit = editAuthoringQuestion(single);
  for (const patch of [
    { scoreText: '' },
    { scoreText: '0' },
    { scoreText: '1.234' },
    { difficultyText: '6' },
    { answer: ['missing'] },
    { knowledgeText: '' },
    { stem: '' },
  ])
    assert.throws(() => commitAuthoringQuestions([{ ...edit, ...patch }]));
  assert.throws(() => commitAuthoringQuestions([edit, { ...edit, stem: '2 + 2 等于多少？  ' }]));
  assert.throws(() =>
    commitAuthoringQuestions([{ ...edit, type: 'blank', stem: '___ 加 ___', options: [], answerText: '4' }]),
  );
  assert.throws(() => commitAuthoringQuestions([{ ...edit, type: 'multiple', answer: ['A'] }]));
});
test('native statistics preserve insufficient and zero values with actual counts instead of fabricating grades', () => {
  const data: LearningAnalyticsData = {
    hasExportData: true,
    metrics: [
      { label: '平均成绩', value: '数据不足', detail: '0个已发布成绩' },
      { label: '练习正确率', value: '0%' },
    ],
    rules: ['未发布不作为零分'],
    courseProgress: [{ name: '课程', completed: 0, total: 1, percent: 0 }],
    scoreTrend: [],
    knowledgePoints: [{ name: '概念', total: 1, correct: 0, accuracy: 0, recommendation: '数据不足' }],
    distribution: [{ name: '0–59', count: 0 }],
    students: [],
    taskSummary: {
      expectedSubmissions: 0,
      submitted: 0,
      missing: 0,
      late: 0,
      submissionRate: null,
      lateRate: null,
      rule: '按有效成员',
    },
  };
  const result = nativeAnalyticsResult(data, true);
  assert.equal(result.metrics[0].value, '数据不足');
  assert.equal(result.metrics[1].value, '0%');
  assert.deepEqual(result.tables.find((t) => t.title === '已发布成绩')!.rows, []);
  assert.equal(result.tables.find((t) => t.title === '知识点练习')!.rows[0].correct, 0);
  assert.ok(result.sections.find((s) => s.title === '作业提交情况')!.content.includes('提交率 数据不足'));
  assert.equal(result.categoryChart!.series[0].values[0], 0);
  const past = nativeAnalyticsResult({
    ...data,
    scoreTrend: [{ name: '过去任务', score: 60, userId: 'former', date: new Date(0).toISOString() }],
  });
  assert.equal(past.tables.find((t) => t.title === '已发布成绩')!.rows[0].student, '历史学生');
});

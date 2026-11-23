import type { AcademicResult } from './academics-model';
import { richParts } from './assignment-model';
export type LearningAnalyticsData = {
  hasExportData: boolean;
  metrics: { label: string; value: string | number; detail?: string }[];
  rules: string[];
  courseProgress: { name: string; completed: number; total: number; percent: number }[];
  scoreTrend: { name: string; score: number; date: string; userId: string }[];
  knowledgePoints: {
    name: string;
    total: number;
    correct: number;
    accuracy: number;
    recommendation: string;
  }[];
  distribution: { name: string; count: number }[];
  students: { id: string; name: string; completed: number; total: number; percent: number }[];
  taskSummary?: {
    expectedSubmissions: number;
    submitted: number;
    missing: number;
    late: number;
    submissionRate: number | null;
    lateRate: number | null;
    rule: string;
  };
  questionStats?: { id: string; stem: string; total: number; correct: number; accuracy: number }[];
  classComparison?: {
    name: string;
    studentCount: number;
    completed: number;
    total: number;
    percent: number;
    averageScore: number | null;
    scoreCount: number;
  }[];
  suggestions?: { userId: string; name: string; reason: string }[];
};
export type AnalyticsFilters = {
  canExport: boolean;
  courses: { id: string; title: string }[];
  classes: { id: string; name: string }[];
  terms: { id: string; name: string }[];
};
export function nativeAnalyticsResult(data: LearningAnalyticsData, own = false): AcademicResult {
  const table = (
    title: string,
    columns: [string, string][],
    rows: AcademicResult['tables'][number]['rows'],
  ) => ({ title, columns: columns.map(([key, title]) => ({ key, title })), rows });
  return {
    summary: '统计当前授权范围的全部历史，缺考、未提交、待批阅和未发布成绩不作为零分。',
    metrics: data.metrics.map((m) => ({ label: m.label, value: m.value })),
    tables: [
      table(
        '课程学习进度',
        [
          ['name', '课程'],
          ['completed', '已完成课时'],
          ['total', '应完成课时'],
          ['percent', '完成率（%）'],
        ],
        data.courseProgress,
      ),
      table(
        '已发布成绩',
        [
          ['name', '任务'],
          ['score', '百分制成绩'],
          ['date', '提交时间'],
          ['student', '学生'],
        ],
        data.scoreTrend.map((row) => ({
          name: row.name,
          score: row.score,
          date: new Date(row.date).toLocaleString(),
          student: own ? '本人' : data.students.find((s) => s.id === row.userId)?.name || '历史学生',
        })),
      ),
      table(
        '知识点练习',
        [
          ['name', '知识点'],
          ['correct', '完全正确次数'],
          ['total', '作答次数'],
          ['accuracy', '正确率（%）'],
          ['recommendation', '复习建议'],
        ],
        data.knowledgePoints,
      ),
      ...(data.students.length
        ? [
            table(
              '学生课时进度',
              [
                ['name', '学生'],
                ['completed', '已完成'],
                ['total', '应完成'],
                ['percent', '完成率（%）'],
              ],
              data.students,
            ),
          ]
        : []),
      ...(data.questionStats?.length
        ? [
            table(
              '题目作答统计',
              [
                ['stem', '题目'],
                ['correct', '正确次数'],
                ['total', '作答次数'],
                ['accuracy', '正确率（%）'],
              ],
              data.questionStats.map((row) => ({
                ...row,
                stem: richParts(row.stem)
                  .filter((p) => p.kind === 'text')
                  .map((p) => p.value)
                  .join('\n'),
              })),
            ),
          ]
        : []),
      ...(data.classComparison?.length
        ? [
            table(
              '班级对比',
              [
                ['name', '班级'],
                ['studentCount', '学生数'],
                ['completed', '已完成课时'],
                ['total', '应完成课时'],
                ['averageScore', '有效平均成绩'],
                ['scoreCount', '有效成绩数'],
              ],
              data.classComparison,
            ),
          ]
        : []),
    ],
    sections: [
      ...data.metrics.filter((m) => m.detail).map((m) => ({ title: m.label + '口径', content: m.detail! })),
      ...(data.taskSummary
        ? [
            {
              title: '作业提交情况',
              content: `应提交 ${data.taskSummary.expectedSubmissions} 份，已提交 ${data.taskSummary.submitted} 份，尚未提交 ${data.taskSummary.missing} 份，迟交 ${data.taskSummary.late} 份。提交率 ${data.taskSummary.submissionRate == null ? '数据不足' : data.taskSummary.submissionRate + '%'}；迟交率 ${data.taskSummary.lateRate == null ? '数据不足' : data.taskSummary.lateRate + '%'}。\n${data.taskSummary.rule}`,
            },
          ]
        : []),
      ...(data.suggestions || []).map((s) => ({ title: s.name + ' · 学习提醒', content: s.reason })),
      { title: '统计口径', content: data.rules.join('\n\n') },
    ],
    ...(data.distribution.length
      ? {
          categoryChart: {
            title: '已发布成绩分布',
            categories: data.distribution.map((v) => v.name),
            series: [{ name: '有效成绩数', values: data.distribution.map((v) => v.count) }],
            yAxisLabel: '份',
          },
        }
      : {}),
  };
}

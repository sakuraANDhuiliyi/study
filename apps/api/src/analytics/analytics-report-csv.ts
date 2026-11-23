import { csvCell } from '../common/utils';

type TaskSummary = {
  expectedSubmissions: number;
  submitted: number;
  missing: number;
  late: number;
  submissionRate: number | null;
  lateRate: number | null;
};

type AnalyticsReport = {
  metrics: { label: string; value: number | string; detail: string }[];
  taskSummary?: TaskSummary;
  scoreTrend: { name: string; score: number; date: Date; userId: string; pass: boolean }[];
  knowledgePoints: {
    name: string;
    accuracy: number;
    correct: number;
    total: number;
    recommendation: string;
  }[];
};

/** The controller supplies the same scoped report used by the charts, before UI pagination. */
export function analyticsReportCsv(report: AnalyticsReport, includeTeachingMetrics: boolean) {
  const rows: (string | number)[][] = [
    ['分区', '名称', '数值', '说明', '时间（UTC）', '学生ID', '完全答对次数', '作答样本量'],
  ];
  function summary(label: string, value: number | string, detail: string) {
    rows.push(['汇总概览', label, value, detail, '', '', '', '']);
  }
  for (const metric of report.metrics) summary(metric.label, metric.value, metric.detail);
  const tasks = report.taskSummary;
  if (includeTeachingMetrics && tasks) {
    summary('应提交作业', tasks.expectedSubmissions, '当前有效教学任务与学生关系');
    summary('已提交作业', tasks.submitted, `尚未提交 ${tasks.missing} 份`);
    summary(
      '作业提交率',
      tasks.submissionRate === null ? '数据不足' : `${tasks.submissionRate}%`,
      '有效已提交 / 应提交',
    );
    summary(
      '作业迟交率',
      tasks.lateRate === null ? '数据不足' : `${tasks.lateRate}%`,
      `迟交 ${tasks.late} 份 / 有效已提交`,
    );
  }
  for (const row of report.scoreTrend) {
    rows.push([
      '成绩明细',
      row.name,
      row.score,
      row.pass ? '及格' : '未及格',
      row.date.toISOString(),
      row.userId,
      '',
      '',
    ]);
  }
  if (!report.scoreTrend.length) rows.push(['成绩明细', '', '', '暂无已发布有效成绩', '', '', '', '']);
  for (const row of report.knowledgePoints) {
    rows.push([
      '知识点掌握度',
      row.name,
      `${row.accuracy}%`,
      row.recommendation,
      '',
      '',
      row.correct,
      row.total,
    ]);
  }
  if (!report.knowledgePoints.length)
    rows.push(['知识点掌握度', '', '', '暂无知识点作答样本', '', '', '', '']);
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

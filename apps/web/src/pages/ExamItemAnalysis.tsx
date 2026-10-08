import { useState } from 'react';
import { Alert, Button, Progress, Space, Table, Tag } from 'antd';
import { RefreshCw } from 'lucide-react';
import { date, label, useData } from '../api';
import { useAuth } from '../auth';
import { EmptyState, Panel, QueryState, RichContent } from '../components/shared';

type Item = {
  questionVersionId: string;
  position: number;
  type: string;
  stem: string;
  scoreCents: number;
  participantCount: number;
  answeredCount: number;
  unansweredCount: number;
  gradedCount: number;
  pendingCount: number;
  correctCount: number | null;
  correctRate: number | null;
  averageScoreCents: number | null;
  scoreRate: number | null;
  invalidResponseCount: number;
  options: { id: string; text: string; count: number; percent: number | null }[];
};
type Report = {
  exam: { status: string };
  items: Item[];
  participantCount: number;
  submittedAttemptCount: number;
  smallSample: boolean;
  total: number;
  generatedAt: string;
  rules: string[];
};
const percent = (value: number | null) => (value === null ? '—' : `${value}%`);
const points = (value: number | null) => (value === null ? '—' : Number((value / 100).toFixed(2)));

export function ExamItemAnalysis({ exam }: { exam: { id: string; graderIds?: string[] } }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const administrator = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');
  const allowed =
    !!user &&
    user.role !== 'STUDENT' &&
    user.permissions.includes('assessment.grade') &&
    (!administrator || user.permissions.includes('analysis.sensitive')) &&
    (!exam.graderIds?.length || exam.graderIds.includes(user.id));
  const query = useData<Report>(`/exams/${exam.id}/item-analysis?page=${page}&pageSize=20`, allowed);
  const report = query.data;
  if (!allowed)
    return (
      <Alert
        showIcon
        type="info"
        message="题目分析需要本考试阅卷权限"
        description={
          administrator ? '管理角色还需独立的教学统计敏感授权。' : '请由本考试指定的阅卷教师查看。'
        }
      />
    );
  return (
    <Panel
      title="考试题目分析"
      description="每位学生取最近一次有效交卷，按考试固定试卷统计。"
      extra={
        <Button
          icon={<RefreshCw size={14} />}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新分析
        </Button>
      }
    >
      <QueryState query={query}>
        {report && (
          <>
            {report.exam.status === 'cancelled' && (
              <Alert
                style={{ marginBottom: 16 }}
                showIcon
                type="warning"
                message="考试已取消：以下仅为历史交卷的描述性数据，不代表当前有效测验结果。"
              />
            )}
            <Space wrap style={{ marginBottom: 16 }}>
              <Tag color="blue">有效参考人数 {report.participantCount}</Tag>
              <Tag>已交卷次数 {report.submittedAttemptCount}</Tag>
              <span className="muted">更新于 {date(report.generatedAt)}</span>
            </Space>
            {report.smallSample && (
              <Alert
                style={{ marginBottom: 16 }}
                showIcon
                type="info"
                message={
                  report.participantCount
                    ? '小样本：不足 5 人，结果仅作描述，不用于判定题目质量。'
                    : '尚无有效交卷，统计比例暂不计算。'
                }
              />
            )}
            <Table<Item>
              rowKey="questionVersionId"
              dataSource={report.items}
              scroll={{ x: 1000 }}
              locale={{ emptyText: <EmptyState description="发布固定试卷后可查看题目分析" /> }}
              pagination={{
                current: page,
                pageSize: 20,
                total: report.total,
                showSizeChanger: false,
                onChange: setPage,
              }}
              columns={[
                { title: '题号', dataIndex: 'position', width: 65, render: (value: number) => value + 1 },
                {
                  title: '题目',
                  width: 290,
                  render: (_, item) => (
                    <>
                      <Tag>{label(item.type)}</Tag>
                      <RichContent content={item.stem} />
                    </>
                  ),
                },
                {
                  title: '作答 / 参考',
                  width: 110,
                  render: (_, item) => `${item.answeredCount} / ${item.participantCount}`,
                },
                {
                  title: '客观完全正确率',
                  width: 140,
                  render: (_, item) => (item.correctCount === null ? '不适用' : percent(item.correctRate)),
                },
                {
                  title: '平均得分 / 满分',
                  width: 140,
                  render: (_, item) => `${points(item.averageScoreCents)} / ${points(item.scoreCents)}`,
                },
                { title: '平均得分率', width: 110, render: (_, item) => percent(item.scoreRate) },
                {
                  title: '已评分 / 待批阅',
                  width: 130,
                  render: (_, item) => `${item.gradedCount} / ${item.pendingCount}`,
                },
              ]}
              expandable={{
                expandedRowRender: (item) => (
                  <div>
                    <Space wrap style={{ marginBottom: 12 }}>
                      <Tag>空答 {item.unansweredCount} 人</Tag>
                      {item.invalidResponseCount > 0 && (
                        <Tag color="orange">无效选项答复 {item.invalidResponseCount} 人</Tag>
                      )}
                    </Space>
                    {item.options.length ? (
                      <>
                        <p className="muted">
                          选项频次以 {item.participantCount} 位参考学生为分母。
                          {item.type === 'multiple' && '多选题比例合计可以超过 100%。'}
                        </p>
                        {item.options.map((option) => (
                          <div key={option.id} style={{ maxWidth: 640, marginBottom: 12 }}>
                            <span>
                              {option.id}. {option.text} · {option.count} 人（{percent(option.percent)}）
                            </span>
                            <Progress percent={option.percent ?? 0} showInfo={false} strokeColor="#206bc4" />
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="muted">
                        本题型不汇总原始文本答案；可在“按题阅卷”中查看授权范围内的答卷。
                      </p>
                    )}
                  </div>
                ),
              }}
            />
            <div className="rules-panel" style={{ marginTop: 16 }}>
              <h3>统计口径</h3>
              <ul>
                {report.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </QueryState>
    </Panel>
  );
}

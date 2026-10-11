import { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Popconfirm, Space } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { api, date, label, useAction, useData } from '../../api';
import { EmptyState, PageTitle, Panel, QueryState, Status } from '../../components/shared';
import { qid, QuestionView, money } from './shared';

export function Grading() {
  const { id } = useParams();
  const query = useData(`/attempts/${id}`);
  const history = useData(`/attempts/${id}/revisions`);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const d = query.data;
  const action = useAction('批阅已保存');
  const loaded = useRef('');
  const gradeRevision = useRef(0);
  useEffect(() => {
    if (d && loaded.current !== id) {
      gradeRevision.current = d.gradingRevision;
      setScores(
        Object.fromEntries(
          d.answers
            .filter((a: any) => a.scoreCents !== undefined && a.scoreCents !== null)
            .map((a: any) => [a.questionVersionId, a.scoreCents / 100]),
        ),
      );
      setComment(d.feedback || '');
      setComments(Object.fromEntries(d.answers.map((a: any) => [a.questionVersionId, a.comment || ''])));
      loaded.current = id || '';
    }
  }, [d, id]);
  const readonly = d?.releaseStatus === 'released' || !['submitted', 'timed_out'].includes(d?.status);
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to={`/exams/${d.exam.id}`} className="back-link">
            ← 返回考试管理
          </Link>
          <PageTitle
            eyebrow="EXAM GRADING"
            title={`阅卷 · ${d.exam.title}`}
            description="按固定试卷版本批阅，分值不能超过题目满分。发布后的成绩通过复核流程修改。"
            extra={
              <Space>
                <Status value={d.status} />
                <Status value={d.gradingStatus} />
              </Space>
            }
          />
          <div className="content-two-columns">
            <Panel title="答卷与评分">
              {d.items.map((q: any, index: number) => (
                <div className="grading-question" key={qid(q)}>
                  <QuestionView
                    question={q}
                    index={index}
                    value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                    onChange={() => {}}
                    disabled
                    explain
                  />
                  <div className="grading-controls">
                    <span>得分</span>
                    <InputNumber
                      value={scores[qid(q)]}
                      min={0}
                      max={q.scoreCents / 100}
                      precision={2}
                      disabled={readonly}
                      placeholder="客观题可自动"
                      onChange={(v) => setScores((prev) => ({ ...prev, [qid(q)]: v }))}
                    />
                    <span>/ {money(q.scoreCents)} 分</span>
                    <Input
                      value={comments[qid(q)] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [qid(q)]: e.target.value }))}
                      disabled={readonly}
                      placeholder="题目批注"
                    />
                  </div>
                </div>
              ))}
            </Panel>
            <div className="stack">
              <Panel title="批阅概况">
                <dl className="info-list" style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <dt>提交时间</dt>
                    <dd>{date(d.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt>总分</dt>
                    <dd>
                      {money(d.scoreCents)} / {money(d.exam.totalCents)} 分
                    </dd>
                  </div>
                  <div>
                    <dt>成绩状态</dt>
                    <dd>{label(d.releaseStatus)}</dd>
                  </div>
                </dl>
                <Input.TextArea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  placeholder="总体批阅意见"
                  style={{ marginTop: 22 }}
                  disabled={readonly}
                />
                <Button
                  style={{ marginTop: 20 }}
                  block
                  type="primary"
                  disabled={readonly}
                  loading={action.isPending}
                  onClick={async () => {
                    const result = await action.mutateAsync({
                      path: `/attempts/${id}/grade`,
                      method: 'PUT',
                      body: {
                        revision: gradeRevision.current,
                        items: Object.entries(scores)
                          .filter(([, score]) => score !== null && score !== undefined)
                          .map(([questionVersionId, score]) => ({
                            questionVersionId,
                            scoreCents: Math.round(Number(score) * 100),
                            comment: comments[questionVersionId] || '',
                          })),
                        comment,
                      },
                    });
                    gradeRevision.current = result.gradingRevision;
                  }}
                >
                  保存阅卷
                </Button>
                <p className="form-hint" style={{ margin: '13px 0 0' }}>
                  多人阅卷使用版本检测，冲突时请重新载入并检查已有评分。
                </p>
              </Panel>
              <Popconfirm
                title="重新载入会放弃本页面尚未保存的评分，确认继续？"
                onConfirm={async () => {
                  const fresh = await api(`/attempts/${id}`);
                  gradeRevision.current = fresh.gradingRevision;
                  setScores(
                    Object.fromEntries(
                      fresh.answers
                        .filter((answer: any) => answer.scoreCents != null)
                        .map((answer: any) => [answer.questionVersionId, answer.scoreCents / 100]),
                    ),
                  );
                  setComments(
                    Object.fromEntries(
                      fresh.answers.map((answer: any) => [answer.questionVersionId, answer.comment || '']),
                    ),
                  );
                  setComment(fresh.feedback || '');
                  await query.refetch();
                }}
              >
                <Button>重新载入服务器评分</Button>
              </Popconfirm>
              <Panel title="成绩修改记录">
                <QueryState query={history}>
                  {history.data?.items?.length ? (
                    history.data.items.map((r: any) => (
                      <div className="reply-item" key={r.id}>
                        <div style={{ fontSize: 12 }}>
                          {money(r.oldScoreCents)} → {money(r.newScoreCents)} 分
                        </div>
                        <p>{r.reason}</p>
                        <div className="table-secondary">{date(r.createdAt)}</div>
                      </div>
                    ))
                  ) : (
                    <EmptyState description="暂无改分记录" />
                  )}
                </QueryState>
              </Panel>
            </div>
          </div>
        </>
      )}
    </QueryState>
  );
}

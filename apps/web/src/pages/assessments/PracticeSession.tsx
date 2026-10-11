import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { ArrowLeft, ArrowRight, Bookmark, Flag } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, send, useAction, useData } from '../../api';
import { Metrics, PageTitle, Panel, QueryState, useUnsavedWarning } from '../../components/shared';
import { qid, money, QuestionView, answered } from './shared';

export function PracticeSession() {
  const { id } = useParams();
  const query = useData(`/practice/${id}`);
  const d = query.data;
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<any>();
  const [flagged, setFlagged] = useState<string[]>([]);
  const revision = useRef(0);
  const [progressReady, setProgressReady] = useState(false);
  const loaded = useRef('');
  const desired = useRef({ currentPosition: 0, flags: [] as string[] });
  const savedProgress = useRef('');
  const savingProgress = useRef(false);
  const progressConflict = useRef(false);
  const [progressStatus, setProgressStatus] = useState('已保存练习位置');
  const restore = (data: any) => {
    revision.current = data.revision || 0;
    const current = { currentPosition: data.currentPosition || 0, flags: data.flags || [] };
    desired.current = current;
    savedProgress.current = JSON.stringify(current);
    progressConflict.current = false;
    setIndex(current.currentPosition);
    setFlagged(current.flags);
    setProgressStatus('已保存练习位置');
    setProgressReady(true);
  };
  useEffect(() => {
    if (d && loaded.current !== id) {
      loaded.current = id || '';
      restore(d);
    }
  }, [d, id]);
  async function persistProgress() {
    if (savingProgress.current || progressConflict.current || loaded.current !== id) return;
    const payload = { ...desired.current };
    const signature = JSON.stringify(payload);
    if (signature === savedProgress.current) return;
    savingProgress.current = true;
    setProgressStatus('正在保存练习位置…');
    let success = false;
    try {
      const result = await send(
        `/practice/${id}/progress`,
        { ...payload, revision: revision.current },
        'PUT',
      );
      revision.current = result.revision;
      savedProgress.current = signature;
      success = true;
      setProgressStatus(JSON.stringify(desired.current) === signature ? '已保存练习位置' : '练习位置未同步');
    } catch (error) {
      progressConflict.current = error instanceof ApiError && error.status === 409;
      setProgressStatus(
        progressConflict.current ? '其他页面已修改练习位置，请载入服务器版本' : '练习位置未同步，请重试',
      );
    } finally {
      savingProgress.current = false;
      if (success && JSON.stringify(desired.current) !== signature) void persistProgress();
    }
  }
  useEffect(() => {
    if (!progressReady || loaded.current !== id) return;
    desired.current = { currentPosition: index, flags: flagged };
    if (JSON.stringify(desired.current) === savedProgress.current) return;
    setProgressStatus('练习位置未同步');
    const timer = setTimeout(() => void persistProgress(), 350);
    return () => clearTimeout(timer);
  }, [index, flagged, progressReady]);
  useEffect(() => {
    const online = () => void persistProgress();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [id]);
  useUnsavedWarning(progressStatus.includes('未同步') || progressStatus.includes('正在保存'));
  const action = useAction('');
  const [report, setReport] = useState(false);
  const question = d?.items?.[index];
  const saved = d?.answers?.find((a: any) => a.questionVersionId === qid(question || {}));
  useEffect(() => {
    setValue(saved?.value);
  }, [index, saved?.questionVersionId]);
  async function answer() {
    await action.mutateAsync({
      path: `/practice/${id}/answer`,
      body: { questionVersionId: qid(question), value },
    });
    query.refetch();
  }
  const currentReport = d?.report;
  return (
    <QueryState query={query}>
      {d && (
        <>
          <Link to="/practice" className="back-link">
            ← 返回练习中心
          </Link>
          <PageTitle
            eyebrow="FOCUSED PRACTICE"
            title={report ? '本次练习报告' : '专注练习，稳步进阶'}
            description={currentReport?.note || '单题提交后显示答案与解析。主观题请对照参考答案复盘。'}
            extra={<Button onClick={() => setReport(!report)}>{report ? '返回答题' : '查看报告'}</Button>}
          />
          <div className="form-hint" style={{ marginBottom: 16 }}>
            {progressStatus}
            {progressStatus.includes('未同步') && (
              <Button size="small" type="link" onClick={() => void persistProgress()}>
                重试保存
              </Button>
            )}
            {progressConflict.current && (
              <Button
                size="small"
                type="link"
                onClick={async () => {
                  const fresh = await query.refetch();
                  if (fresh.data) restore(fresh.data);
                }}
              >
                载入服务器版本
              </Button>
            )}
          </div>
          {report ? (
            <>
              <Metrics
                items={[
                  {
                    label: '已完成题目',
                    value: `${currentReport?.answered || 0} / ${currentReport?.total || 0}`,
                    detail: '本次练习实际作答情况',
                  },
                  {
                    label: '客观题正确',
                    value: currentReport?.correct || 0,
                    detail: `可自动评分 ${currentReport?.objectivelyScored || 0} 题`,
                  },
                  {
                    label: '客观正确率',
                    value: currentReport?.objectivelyScored
                      ? `${Math.round((currentReport.correct / currentReport.objectivelyScored) * 100)}%`
                      : '数据不足',
                    detail: '正确数 / 已评分客观题数',
                  },
                  { label: '已得分', value: money(currentReport?.scoreCents), detail: '主观题不计自动得分' },
                ]}
              />
              <Panel title="作答回顾">
                {d.items.map((q: any, i: number) => (
                  <QuestionView
                    question={q}
                    index={i}
                    key={qid(q)}
                    value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                    onChange={() => {}}
                    disabled
                    explain
                  />
                ))}
              </Panel>
            </>
          ) : (
            <div className="content-two-columns">
              <Panel>
                {question && (
                  <>
                    <div className="list-title-line">
                      <span className="form-hint">
                        题目 {index + 1} / {d.items.length}
                      </span>
                      <Button
                        type="text"
                        icon={<Bookmark size={16} />}
                        onClick={() =>
                          action.mutate({
                            path: `/questions/${question.questionId}/favorite`,
                            method: 'PUT',
                            body: { favorite: true },
                          })
                        }
                      >
                        收藏此题
                      </Button>
                    </div>
                    <QuestionView
                      question={question}
                      index={index}
                      value={saved?.value ?? value}
                      onChange={setValue}
                      disabled={!!saved}
                      explain={!!saved}
                    />
                    {saved && (
                      <Alert
                        style={{ marginTop: 20 }}
                        showIcon
                        type={
                          saved.correct === true ? 'success' : saved.correct === false ? 'warning' : 'info'
                        }
                        message={
                          saved.correct === true
                            ? '回答正确，继续保持'
                            : saved.correct === false
                              ? '这一题值得再想一想，错题记录已保存'
                              : '主观题已记录，请对照评分参考自我复盘'
                        }
                      />
                    )}
                    <div className="answer-controls">
                      <Button
                        disabled={index === 0}
                        icon={<ArrowLeft size={15} />}
                        onClick={() => setIndex(index - 1)}
                      >
                        上一题
                      </Button>
                      <Space>
                        <Button
                          icon={<Flag size={14} />}
                          onClick={() =>
                            setFlagged(
                              flagged.includes(qid(question))
                                ? flagged.filter((x) => x !== qid(question))
                                : [...flagged, qid(question)],
                            )
                          }
                        >
                          {flagged.includes(qid(question)) ? '取消标记' : '稍后复习'}
                        </Button>
                        {!saved ? (
                          <Button
                            type="primary"
                            onClick={answer}
                            disabled={!answered(value)}
                            loading={action.isPending}
                          >
                            提交本题
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            onClick={() =>
                              index === d.items.length - 1 ? setReport(true) : setIndex(index + 1)
                            }
                          >
                            {index === d.items.length - 1 ? '查看练习报告' : '下一题'}
                            <ArrowRight size={15} />
                          </Button>
                        )}
                      </Space>
                    </div>
                  </>
                )}
              </Panel>
              <Panel title="答题卡" description={`已作答 ${d.answers.length} / ${d.items.length} 题`}>
                <div className="answer-sheet">
                  {d.items.map((q: any, i: number) => (
                    <button
                      key={qid(q)}
                      aria-label={`第 ${i + 1} 题`}
                      onClick={() => setIndex(i)}
                      className={`${i === index ? 'current' : ''} ${d.answers.some((a: any) => a.questionVersionId === qid(q)) ? 'answered' : ''} ${flagged.includes(qid(q)) ? 'flagged' : ''}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <div className="sheet-legend">
                  <span>
                    <i className="sheet-dot saved" />
                    已作答
                  </span>
                  <span>
                    <i className="sheet-dot" />
                    未作答
                  </span>
                  <span>
                    <i className="sheet-dot flag" />
                    已标记
                  </span>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </QueryState>
  );
}

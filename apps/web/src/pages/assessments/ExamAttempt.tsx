import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Modal, Popconfirm, Space, Tag, Result } from 'antd';
import { ArrowLeft, ArrowRight, CheckCircle2, Flag, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, date, label, send, useAction, useData } from '../../api';
import { useAuth } from '../../auth';
import { PageTitle, Panel, QueryState, useUnsavedWarning } from '../../components/shared';
import { answerMap, answerArray, qid, answered, money, QuestionView } from './shared';

export function ExamAttempt() {
  const { id } = useParams();
  const { user } = useAuth();
  const query = useData(`/attempts/${id}`);
  const d = query.data;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'offline' | 'conflict'>('saved');
  const [lastSaved, setLastSaved] = useState<string>();
  const [remaining, setRemaining] = useState(0);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const action = useAction('复核申请已提交');
  const { modal, message } = App.useApp();
  const loaded = useRef('');
  const revision = useRef(0);
  const latest = useRef<Record<string, any>>({});
  const pending = useRef<Record<string, any>>({});
  const flagsRef = useRef<string[]>([]);
  const position = useRef(0);
  const needsMeta = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false);
  const offset = useRef(0);
  const submitKey = useRef(crypto.randomUUID());
  const autoSubmitted = useRef(false);
  const draftKey = `zhixue:exam:${user?.id}:${id}`;
  const [unsynced, setUnsynced] = useState(false);
  useUnsavedWarning(unsynced && d?.status === 'in_progress');
  function storeDraft() {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          revision: revision.current,
          pending: pending.current,
          flags: flagsRef.current,
          currentPosition: position.current,
          needsMeta: needsMeta.current,
        }),
      );
    } catch {
      /* browser storage can be unavailable */
    }
  }
  function initialize(server: any, discard = false) {
    const synced = answerMap(server.answers);
    revision.current = server.revision;
    offset.current = new Date(server.serverTime).getTime() - Date.now();
    position.current = server.currentPosition || 0;
    flagsRef.current = server.flags || [];
    pending.current = {};
    needsMeta.current = false;
    blocked.current = false;
    if (!discard && server.status === 'in_progress') {
      try {
        const local = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
        if (local && (Object.keys(local.pending || {}).length || local.needsMeta)) {
          pending.current = local.pending;
          Object.assign(synced, local.pending);
          if (local.revision !== server.revision) {
            blocked.current = true;
            setStatus('conflict');
          } else {
            setStatus('dirty');
            flagsRef.current = local.flags || flagsRef.current;
            position.current = local.currentPosition ?? position.current;
            needsMeta.current = !!local.needsMeta;
          }
        }
      } catch {
        /* ignore invalid local draft */
      }
    }
    latest.current = synced;
    setAnswers(synced);
    setFlags(flagsRef.current);
    setIndex(position.current);
    setLastSaved(server.lastSavedAt);
    setUnsynced(Object.keys(pending.current).length > 0 || needsMeta.current);
    if (discard || (!Object.keys(pending.current).length && !needsMeta.current)) setStatus('saved');
    if (discard) sessionStorage.removeItem(draftKey);
  }
  useEffect(() => {
    if (d && loaded.current !== id) {
      initialize(d);
      loaded.current = id || '';
    }
  }, [d, id]);
  const finished = d && d.status !== 'in_progress';
  async function save(): Promise<boolean> {
    if (blocked.current) return false;
    if (inFlight.current) {
      const success = await inFlight.current;
      if (!success) return false;
      return save();
    }
    if (!Object.keys(pending.current).length && !needsMeta.current) return true;
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    const snapshot = { ...pending.current };
    const savedMeta = JSON.stringify([flagsRef.current, position.current]);
    setStatus('saving');
    inFlight.current = (async () => {
      try {
        const result = await send(
          `/attempts/${id}/answers`,
          {
            revision: revision.current,
            answers: answerArray(snapshot),
            flags: flagsRef.current,
            currentPosition: position.current,
          },
          'PUT',
        );
        revision.current = result.revision;
        offset.current = new Date(result.serverTime).getTime() - Date.now();
        for (const key of Object.keys(snapshot))
          if (JSON.stringify(pending.current[key]) === JSON.stringify(snapshot[key]))
            delete pending.current[key];
        if (savedMeta === JSON.stringify([flagsRef.current, position.current])) needsMeta.current = false;
        setLastSaved(result.lastSavedAt);
        const dirty = Object.keys(pending.current).length > 0 || needsMeta.current;
        setUnsynced(dirty);
        setStatus(dirty ? 'dirty' : 'saved');
        if (dirty) storeDraft();
        else sessionStorage.removeItem(draftKey);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setStatus('conflict');
          query.refetch();
        } else setStatus('offline');
        setUnsynced(true);
        storeDraft();
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }
  useEffect(() => {
    if (finished) return;
    if (status === 'dirty') {
      const timer = setTimeout(() => {
        void save();
      }, 850);
      return () => clearTimeout(timer);
    }
  }, [answers, flags, index, status, finished]);
  useEffect(() => {
    const offline = () => setStatus('offline');
    const online = () => {
      if (!blocked.current) {
        setStatus('dirty');
        void save();
      }
      query.refetch();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [id]);
  useEffect(() => {
    if (!d?.deadlineAt || finished) return;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((new Date(d.deadlineAt).getTime() - Date.now() - offset.current) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0 && !autoSubmitted.current) {
        autoSubmitted.current = true;
        void send(`/attempts/${id}/submit`, { idempotencyKey: submitKey.current })
          .then(() => query.refetch())
          .catch(() => {
            setStatus('offline');
            autoSubmitted.current = false;
          });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [d?.deadlineAt, finished, id]);
  useEffect(() => {
    if (finished) {
      setUnsynced(false);
      sessionStorage.removeItem(draftKey);
    }
  }, [finished, draftKey]);
  function change(questionId: string, value: any) {
    latest.current = { ...latest.current, [questionId]: value };
    pending.current[questionId] = value;
    setAnswers(latest.current);
    setUnsynced(true);
    if (!blocked.current) setStatus(navigator.onLine ? 'dirty' : 'offline');
    storeDraft();
  }
  async function navigateQuestion(next: number) {
    if (!d.exam.allowBacktrack) {
      if (next !== index + 1) return;
      if (!(await save())) {
        message.error('请先成功同步当前答案，再进入下一题');
        return;
      }
    }
    position.current = next;
    needsMeta.current = true;
    setIndex(next);
    setUnsynced(true);
    setStatus('dirty');
    storeDraft();
  }
  function flag() {
    const questionId = qid(d.items[index]);
    flagsRef.current = flagsRef.current.includes(questionId)
      ? flagsRef.current.filter((f) => f !== questionId)
      : [...flagsRef.current, questionId];
    needsMeta.current = true;
    setFlags([...flagsRef.current]);
    setUnsynced(true);
    setStatus('dirty');
    storeDraft();
  }
  async function submit() {
    if (!(await save())) throw new Error('答案尚未成功同步，请先重试保存');
    await send(`/attempts/${id}/submit`, { idempotencyKey: submitKey.current });
    setUnsynced(false);
    sessionStorage.removeItem(draftKey);
    await query.refetch();
  }
  function confirmSubmit() {
    const missing = d.items.filter((q: any) => !answered(latest.current[qid(q)])).length;
    modal.confirm({
      title: missing ? `还有 ${missing} 道题未作答，确认交卷？` : '确认提交本次考试？',
      content: '交卷后不能继续修改。系统会先同步当前答案，再完成正式提交。',
      okText: '确认交卷',
      cancelText: '继续答题',
      onOk: async () => {
        try {
          await submit();
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        }
      },
    });
  }
  const question = d?.items?.[index];
  return (
    <QueryState query={query}>
      {d && (
        <>
          <PageTitle
            eyebrow={finished ? 'EXAM RESULT' : 'EXAM IN PROGRESS'}
            title={d.exam.title}
            description={
              finished
                ? '答卷已由服务器接收，成绩按照公开规则展示。'
                : '请保持专注。服务器时间决定截止，修改答案后请确认保存状态。'
            }
            extra={
              finished ? (
                <Link to={`/exams/${d.exam.id}`} className="inline-link">
                  返回考试详情
                  <ArrowRight size={14} />
                </Link>
              ) : (
                <Tag color="blue">第 {d.number} 次作答</Tag>
              )
            }
          />
          {finished ? (
            <>
              <div className="content-two-columns">
                <Panel>
                  <Result
                    status="success"
                    title={d.status === 'timed_out' ? '考试到时，服务器已收卷' : '交卷成功'}
                    subTitle={`提交时间：${date(d.submittedAt)} · ${label(d.gradingStatus)}`}
                  />
                  <div className="result-score">
                    {d.scoreCents !== null && d.scoreCents !== undefined ? (
                      <>
                        <strong>{money(d.scoreCents)}</strong>
                        <span> / {money(d.exam.totalCents)} 分</span>
                        <p>
                          {d.scoreCents >= d.exam.passCents ? '已达到及格分数' : '继续巩固，下一次更进一步'}
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 style={{ fontSize: 23 }}>等待成绩公开</h2>
                        <p>
                          {d.gradingStatus === 'pending'
                            ? '主观题仍在批阅中，暂不显示临时总分。'
                            : `公开时间：${date(d.exam.scoreReleaseAt)}`}
                        </p>
                      </>
                    )}
                  </div>
                </Panel>
                <Panel title="成绩与复核">
                  <dl className="info-list" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <dt>成绩状态</dt>
                      <dd>{label(d.releaseStatus)}</dd>
                    </div>
                    <div>
                      <dt>答案公开时间</dt>
                      <dd>{date(d.exam.answerReleaseAt)}</dd>
                    </div>
                    <div>
                      <dt>解析公开时间</dt>
                      <dd>{date(d.exam.explanationReleaseAt)}</dd>
                    </div>
                    <div>
                      <dt>教师评语公开时间</dt>
                      <dd>{d.exam.commentReleaseAt ? date(d.exam.commentReleaseAt) : '随实际成绩公开'}</dd>
                    </div>
                    <div>
                      <dt>复核截止时间</dt>
                      <dd>{d.exam.appealDeadline ? date(d.exam.appealDeadline) : '未设置固定截止时间'}</dd>
                    </div>
                  </dl>
                  <Button
                    block
                    style={{ marginTop: 20 }}
                    onClick={() => setAppealOpen(true)}
                    disabled={
                      d.releaseStatus !== 'released' ||
                      d.gradingStatus !== 'graded' ||
                      (d.exam.appealDeadline && new Date(d.exam.appealDeadline) <= new Date())
                    }
                  >
                    申请成绩复核
                  </Button>
                </Panel>
              </div>
              {d.feedback && (
                <Panel title="教师总体评语">
                  <p style={{ whiteSpace: 'pre-wrap' }}>{d.feedback}</p>
                </Panel>
              )}
              <Panel
                title="我的答卷"
                description="参考答案和解析只在各自的公开时间后显示"
                className="result-answers"
              >
                {d.items.map((q: any, i: number) => (
                  <div key={qid(q)}>
                    <QuestionView
                      question={q}
                      index={i}
                      value={d.answers.find((a: any) => a.questionVersionId === qid(q))?.value}
                      onChange={() => {}}
                      disabled
                      explain
                    />
                    {d.answers.find((a: any) => a.questionVersionId === qid(q))?.scoreCents !== undefined && (
                      <Tag>
                        本题得分：
                        {money(d.answers.find((a: any) => a.questionVersionId === qid(q)).scoreCents)} 分
                      </Tag>
                    )}
                    {d.answers.find((a: any) => a.questionVersionId === qid(q))?.comment && (
                      <div className="question-explanation">
                        <strong>教师批注</strong>
                        <p style={{ whiteSpace: 'pre-wrap' }}>
                          {d.answers.find((a: any) => a.questionVersionId === qid(q)).comment}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </Panel>
            </>
          ) : (
            <>
              <div className="exam-integrity-status" aria-live="polite">
                {status === 'conflict' && (
                  <Alert
                    type="error"
                    showIcon
                    message="检测到其他页面已修改答案或考试状态已变化"
                    description="已暂停保存，防止旧答案覆盖新版本。确认后重新载入服务器答案；当前未同步草稿将被丢弃。"
                    action={
                      <Popconfirm
                        title="重新载入并丢弃本页面未同步的修改？"
                        onConfirm={async () => {
                          const fresh = await api(`/attempts/${id}`);
                          initialize(fresh, true);
                          query.refetch();
                        }}
                      >
                        <Button danger size="small">
                          重新载入
                        </Button>
                      </Popconfirm>
                    }
                  />
                )}{' '}
                {status === 'offline' && (
                  <Alert
                    type="warning"
                    showIcon
                    message="尚有未同步答案"
                    description="网络可能中断，当前草稿仅存于此浏览器。恢复连接后自动重试，成功同步前不算提交。"
                    action={
                      <Button
                        size="small"
                        onClick={() => {
                          blocked.current = false;
                          void save();
                        }}
                      >
                        重试同步
                      </Button>
                    }
                  />
                )}
              </div>
              <div className="content-two-columns">
                <Panel>
                  {question && (
                    <>
                      <QuestionView
                        question={question}
                        index={index}
                        value={answers[qid(question)]}
                        onChange={(value) => change(qid(question), value)}
                        disabled={status === 'conflict' || remaining === 0}
                      />
                      <div className="answer-controls">
                        <Button
                          icon={<ArrowLeft size={15} />}
                          disabled={index === 0 || !d.exam.allowBacktrack}
                          title={!d.exam.allowBacktrack ? '本次考试不允许返回上一题' : undefined}
                          onClick={() => navigateQuestion(index - 1)}
                        >
                          上一题
                        </Button>
                        <Space>
                          <Button icon={<Flag size={14} />} onClick={flag} disabled={status === 'conflict'}>
                            {flags.includes(qid(question)) ? '取消标记' : '稍后检查'}
                          </Button>
                          {index < d.items.length - 1 ? (
                            <Button
                              type="primary"
                              icon={<ArrowRight size={15} />}
                              iconPosition="end"
                              disabled={status === 'conflict'}
                              onClick={() => navigateQuestion(index + 1)}
                            >
                              下一题
                            </Button>
                          ) : (
                            <Button type="primary" onClick={confirmSubmit} disabled={status === 'conflict'}>
                              检查并交卷
                            </Button>
                          )}
                        </Space>
                      </div>
                    </>
                  )}
                </Panel>
                <div className="stack">
                  <div className="exam-clock">
                    <span>剩余作答时间</span>
                    <strong>
                      {String(Math.floor(remaining / 3600)).padStart(2, '0')}:
                      {String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')}:
                      {String(remaining % 60).padStart(2, '0')}
                    </strong>
                    <p>
                      个人截止时间 {date(d.deadlineAt)}
                      <br />
                      时间来自服务器，到时自动收卷。
                    </p>
                  </div>
                  <Panel
                    title="答题卡"
                    description={`已答 ${Object.values(answers).filter(answered).length} / ${d.items.length} 题`}
                  >
                    <div className="answer-sheet">
                      {d.items.map((q: any, i: number) => (
                        <button
                          key={qid(q)}
                          onClick={() => navigateQuestion(i)}
                          disabled={
                            (!d.exam.allowBacktrack && i !== index && i !== index + 1) ||
                            status === 'conflict'
                          }
                          className={`${i === index ? 'current' : ''} ${answered(answers[qid(q)]) ? 'answered' : ''} ${flags.includes(qid(q)) ? 'flagged' : ''}`}
                          aria-label={`第 ${i + 1} 题，${answered(answers[qid(q)]) ? '已答' : '未答'}`}
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
                    <div
                      className={`save-status ${status === 'offline' || status === 'conflict' ? 'error' : ''}`}
                      role="status"
                    >
                      {status === 'saved' ? <CheckCircle2 size={14} /> : <RefreshCw size={14} />}
                      {
                        {
                          saved: '全部答案已同步',
                          dirty: '存在未同步修改',
                          saving: '正在同步答案…',
                          offline: '未同步，请重试',
                          conflict: '版本冲突，保存已暂停',
                        }[status]
                      }
                    </div>
                    <p className="form-hint" style={{ fontSize: 12 }}>
                      最后成功同步：{date(lastSaved)}
                    </p>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Button
                        block
                        onClick={() => save()}
                        disabled={status === 'conflict'}
                        loading={status === 'saving'}
                      >
                        立即保存
                      </Button>
                      <Button block type="primary" disabled={status === 'conflict'} onClick={confirmSubmit}>
                        提交答卷
                      </Button>
                    </Space>
                  </Panel>
                </div>
              </div>
            </>
          )}
          <Modal
            title="申请成绩复核"
            open={appealOpen}
            onCancel={() => setAppealOpen(false)}
            onOk={async () => {
              await action.mutateAsync({ path: `/attempts/${id}/appeals`, body: { reason: appealReason } });
              setAppealOpen(false);
            }}
            okButtonProps={{ disabled: appealReason.trim().length < 5 }}
          >
            <p className="form-hint">
              请说明需要复核的题目、评分疑问和依据。改分会保留原成绩与完整处理记录。
            </p>
            <Input.TextArea
              rows={5}
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="请输入至少 5 个字的复核理由"
            />
          </Modal>
        </>
      )}
    </QueryState>
  );
}

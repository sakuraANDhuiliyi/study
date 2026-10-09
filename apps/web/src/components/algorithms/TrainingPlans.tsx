import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Modal, Popconfirm, Progress, Select, Space, Tag } from 'antd';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Route, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, send, useData } from '../../api';
import type { User } from '../../api';
import { useAuth } from '../../auth';
import { QueryState } from '../shared';
import type { ProblemCard } from './types';
import './algorithm-training.css';

type CatalogProblem = Omit<ProblemCard, 'status' | 'favorite' | 'reviewStatus'>;
type TrainingPlan = {
  id: string;
  title: string;
  description: string;
  revision: number;
  archived: boolean;
  problemIds: string[];
  problems: ProblemCard[];
  total: number;
  solved: number;
  nextProblemId: string | null;
};
type PlansResponse = {
  items: TrainingPlan[];
  catalog: CatalogProblem[];
  limits: { maxPlans: number; maxProblems: number };
};
type PlanForm = { id?: string; revision: number; title: string; description: string; problemIds: string[] };
type Conflict = { latest: TrainingPlan | null; error?: string; loading?: boolean };
const path = '/algorithms/training-plans';
const problemLink = (id: string, planId: string) =>
  `/algorithms/${encodeURIComponent(id)}?plan=${encodeURIComponent(planId)}`;
const asForm = (plan: TrainingPlan): PlanForm => ({
  id: plan.id,
  revision: plan.revision,
  title: plan.title,
  description: plan.description,
  problemIds: [...plan.problemIds],
});

export function TrainingPlans() {
  const { user } = useAuth();
  return <TrainingPlansContent key={`${user?.organizationId}:${user?.id}:${user?.role}`} />;
}

function TrainingPlansContent() {
  const { user } = useAuth();
  const client = useQueryClient();
  const owner = [user?.organizationId, user?.id, user?.role].join(':');
  const query = useData<PlansResponse>(path);
  const { message } = App.useApp();
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [form, setForm] = useState<PlanForm | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const operation = useRef(false);
  const mounted = useRef(true);
  const expired = useRef(false);
  const editorGeneration = useRef(0);
  const conflictSequence = useRef(0);
  const conflictController = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      expired.current = true;
      invalidateEditor();
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      mounted.current = false;
      invalidateEditor();
      window.removeEventListener('auth-expired', expire);
    };
  }, []);
  function isCurrent() {
    const current = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expired.current &&
      !!current &&
      [current.organizationId, current.id, current.role].join(':') === owner
    );
  }
  function invalidateEditor() {
    editorGeneration.current++;
    conflictSequence.current++;
    conflictController.current?.abort();
    conflictController.current = null;
  }
  const plans = query.data?.items ?? [];
  const catalog = query.data?.catalog ?? [];
  const limits = query.data?.limits ?? { maxPlans: 20, maxProblems: 50 };
  const byId = new Map(catalog.map((problem) => [problem.id, problem]));
  const visible = plans.filter((plan) => filter === 'all' || plan.archived === (filter === 'archived'));
  const busy = saving || actionId !== null;

  function openEditor(plan?: TrainingPlan) {
    invalidateEditor();
    setForm(plan ? asForm(plan) : { revision: 0, title: '', description: '', problemIds: [] });
    setConflict(null);
  }
  async function readConflict(id: string) {
    const generation = editorGeneration.current;
    const sequence = ++conflictSequence.current;
    conflictController.current?.abort();
    const controller = new AbortController();
    conflictController.current = controller;
    const selected = () =>
      isCurrent() && generation === editorGeneration.current && sequence === conflictSequence.current;
    setConflict({ latest: null, loading: true });
    try {
      const response = await api<PlansResponse>(path, { signal: controller.signal });
      if (!selected()) return;
      setConflict({ latest: response.items.find((plan) => plan.id === id) ?? null });
      client.setQueryData([path, owner], response);
    } catch (error) {
      if (selected()) setConflict({ latest: null, error: (error as Error).message });
    } finally {
      if (sequence === conflictSequence.current) conflictController.current = null;
    }
  }
  async function save() {
    if (!form || operation.current || conflict || !form.title.trim() || !form.problemIds.length) return;
    operation.current = true;
    setSaving(true);
    const current = form;
    try {
      const content = {
        title: current.title.trim(),
        description: current.description.trim(),
        problemIds: current.problemIds,
      };
      await send(
        current.id ? `${path}/${encodeURIComponent(current.id)}` : path,
        current.id ? { ...content, revision: current.revision } : content,
        current.id ? 'PATCH' : 'POST',
      );
      if (!isCurrent()) return;
      invalidateEditor();
      setForm(null);
      setConflict(null);
      await query.refetch();
      if (isCurrent()) message.success(current.id ? '训练计划已更新' : '训练计划已创建');
    } catch (error) {
      if (!isCurrent()) return;
      if (current.id && error instanceof ApiError && [409, 404].includes(error.status)) {
        await readConflict(current.id);
      } else message.error((error as Error).message);
    } finally {
      operation.current = false;
      if (isCurrent()) setSaving(false);
    }
  }
  async function action(plan: TrainingPlan, remove = false) {
    if (operation.current) return;
    operation.current = true;
    setActionId(plan.id);
    try {
      await send(
        `${path}/${encodeURIComponent(plan.id)}`,
        remove ? { revision: plan.revision } : { revision: plan.revision, archived: !plan.archived },
        remove ? 'DELETE' : 'PATCH',
      );
      if (!isCurrent()) return;
      message.success(
        remove ? '训练计划已删除，提交记录仍保留' : plan.archived ? '计划已恢复' : '计划已归档',
      );
    } catch (error) {
      if (isCurrent()) message.error((error as Error).message);
    } finally {
      operation.current = false;
      if (isCurrent()) {
        await query.refetch();
        if (isCurrent()) setActionId(null);
      }
    }
  }
  function move(index: number, offset: number) {
    if (!form) return;
    const ids = [...form.problemIds];
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    setForm({ ...form, problemIds: ids });
  }

  return (
    <section id="my-training-plans" className="algo-panel training-plans" aria-label="我的训练计划">
      <div className="algo-panel-heading training-plans-heading">
        <div>
          <h2>
            <Route size={18} /> 我的训练计划
          </h2>
          <p>自行选题、调整顺序，在当前学习空间持续练习。进度包含此前正式提交通过的题目。</p>
        </div>
        <Space wrap>
          <Select
            aria-label="显示训练计划"
            virtual={false}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: '进行中的计划' },
              { value: 'archived', label: '已归档' },
              { value: 'all', label: '全部计划' },
            ]}
          />
          <Button
            icon={<Plus size={15} />}
            disabled={busy || !catalog.length || plans.length >= limits.maxPlans}
            onClick={() => openEditor()}
          >
            新建训练计划
          </Button>
        </Space>
      </div>
      <QueryState query={query}>
        <div className="training-plan-capacity">
          已保存 {plans.length} / {limits.maxPlans} 个计划，每个最多 {limits.maxProblems} 道题
        </div>
        {visible.length ? (
          <div className="training-plan-grid">
            {visible.map((plan) => (
              <article className="training-plan-card" key={plan.id} aria-label={plan.title}>
                <div className="training-plan-title">
                  <h3>{plan.title}</h3>
                  {plan.archived && <Tag>已归档</Tag>}
                </div>
                {plan.description && <p className="training-plan-description">{plan.description}</p>}
                <div className="training-plan-progress">
                  <span>
                    {plan.solved} / {plan.total} 题通过
                  </span>
                  <Progress
                    percent={plan.total ? Math.round((plan.solved / plan.total) * 100) : 0}
                    size="small"
                    showInfo={false}
                  />
                </div>
                <details>
                  <summary>查看全部 {plan.total} 道题</summary>
                  <ol>
                    {plan.problems.map((problem) => (
                      <li key={problem.id}>
                        <Link to={problemLink(problem.id, plan.id)}>
                          <span>{problem.title}</span>
                          {problem.status === 'solved' ? (
                            <CheckCircle2 size={15} aria-label="已通过" />
                          ) : (
                            <span className="training-plan-status">
                              {problem.status === 'attempted' ? '已尝试' : '未开始'}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </details>
                <div className="training-plan-actions">
                  {!plan.archived &&
                    (plan.nextProblemId ? (
                      <Link to={problemLink(plan.nextProblemId, plan.id)}>
                        <Button type="primary" size="small">
                          继续训练
                        </Button>
                      </Link>
                    ) : (
                      <Tag color="green">全部通过</Tag>
                    ))}
                  <Button size="small" disabled={busy} onClick={() => openEditor(plan)}>
                    编辑
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => void action(plan)}>
                    {plan.archived ? '恢复计划' : '归档'}
                  </Button>
                  <Popconfirm
                    title="删除这份训练计划？"
                    description="已保存的代码、笔记和提交记录仍会保留。"
                    okText="删除计划"
                    cancelText="取消"
                    onConfirm={() => action(plan, true)}
                  >
                    <Button size="small" danger disabled={busy} icon={<Trash2 size={13} />}>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="training-plan-empty">
            {filter === 'archived'
              ? '暂无归档计划。'
              : filter === 'all'
                ? '还没有训练计划，选择感兴趣的题目开始吧。'
                : '暂无进行中的计划，可以新建或恢复归档计划。'}
          </p>
        )}
      </QueryState>
      <Modal
        title={form?.id ? '编辑训练计划' : '新建训练计划'}
        open={!!form}
        width={680}
        okText="保存计划"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void save()}
        okButtonProps={{ disabled: !!conflict || !form?.title.trim() || !form.problemIds.length }}
        onCancel={() => {
          if (!saving) {
            invalidateEditor();
            setForm(null);
            setConflict(null);
          }
        }}
        maskClosable={!saving}
        closable={!saving}
      >
        {form && (
          <div className="training-plan-form">
            <label htmlFor="training-plan-title">计划名称</label>
            <Input
              id="training-plan-title"
              value={form.title}
              maxLength={120}
              disabled={saving}
              placeholder="例如：本周数组与字符串复练"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <label htmlFor="training-plan-description">学习说明（可选）</label>
            <Input.TextArea
              id="training-plan-description"
              value={form.description}
              maxLength={800}
              disabled={saving}
              autoSize={{ minRows: 2, maxRows: 5 }}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <label htmlFor="training-plan-problems">选择题目（最多 {limits.maxProblems} 道）</label>
            <Select
              id="training-plan-problems"
              aria-label="选择训练题目"
              mode="multiple"
              showSearch
              virtual={false}
              optionFilterProp="label"
              value={form.problemIds}
              disabled={saving}
              maxCount={limits.maxProblems}
              maxTagCount="responsive"
              onChange={(problemIds) => setForm({ ...form, problemIds })}
              options={catalog.map((problem) => ({
                value: problem.id,
                label: `${String(problem.number).padStart(3, '0')} · ${problem.title} · ${problem.tags.join(' / ')}`,
              }))}
            />
            <p className="training-plan-help">
              下面的顺序决定训练时的上一题、下一题；正式提交通过才会计入进度。
            </p>
            <ol className="training-plan-order" aria-label="训练题目顺序">
              {form.problemIds.map((id, index) => (
                <li key={id}>
                  <span>
                    {index + 1}. {byId.get(id)?.title ?? id}
                  </span>
                  <Space size={4}>
                    <Button
                      size="small"
                      aria-label={`上移第 ${index + 1} 题`}
                      icon={<ArrowUp size={13} />}
                      disabled={saving || index === 0}
                      onClick={() => move(index, -1)}
                    />
                    <Button
                      size="small"
                      aria-label={`下移第 ${index + 1} 题`}
                      icon={<ArrowDown size={13} />}
                      disabled={saving || index === form.problemIds.length - 1}
                      onClick={() => move(index, 1)}
                    />
                    <Button
                      size="small"
                      aria-label={`移除第 ${index + 1} 题`}
                      icon={<Trash2 size={13} />}
                      disabled={saving}
                      onClick={() =>
                        setForm({ ...form, problemIds: form.problemIds.filter((value) => value !== id) })
                      }
                    />
                  </Space>
                </li>
              ))}
            </ol>
            {conflict && (
              <Alert
                type="warning"
                showIcon
                message="计划已更新，当前输入仍保留"
                description={
                  <div>
                    {conflict.loading ? (
                      <p>正在读取最新计划…</p>
                    ) : conflict.error ? (
                      <p>{conflict.error}</p>
                    ) : conflict.latest ? (
                      <>
                        <p>
                          最新版本 {conflict.latest.revision}：{conflict.latest.title}
                        </p>
                        <p>
                          云端题目顺序：{conflict.latest.problems.map((problem) => problem.title).join(' → ')}
                        </p>
                      </>
                    ) : (
                      <p>计划已删除或当前空间不可访问，可以将输入另存为新计划。</p>
                    )}
                    <Space wrap>
                      {conflict.latest && (
                        <>
                          <Button
                            onClick={() => {
                              invalidateEditor();
                              setForm(asForm(conflict.latest!));
                              setConflict(null);
                            }}
                          >
                            载入最新版本
                          </Button>
                          <Button
                            onClick={() => {
                              invalidateEditor();
                              setForm({ ...form, revision: conflict.latest!.revision });
                              setConflict(null);
                            }}
                          >
                            基于最新版本继续编辑
                          </Button>
                        </>
                      )}
                      {!conflict.latest && !conflict.error && !conflict.loading && (
                        <Button
                          disabled={plans.length >= limits.maxPlans}
                          onClick={() => {
                            invalidateEditor();
                            setForm({ ...form, id: undefined, revision: 0 });
                            setConflict(null);
                          }}
                        >
                          另存为新计划
                        </Button>
                      )}
                      {form.id && (
                        <Button loading={conflict.loading} onClick={() => void readConflict(form.id!)}>
                          重新读取最新计划
                        </Button>
                      )}
                    </Space>
                  </div>
                }
              />
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}

export function TrainingPlanNavigation({ problemId }: { problemId: string }) {
  const [params] = useSearchParams();
  const planId = params.get('plan');
  const query = useData<PlansResponse>(path, !!planId);
  if (!planId) return null;
  const plan = query.data?.items?.find((item) => item.id === planId);
  const position = plan?.problemIds.indexOf(problemId) ?? -1;
  return (
    <section className="training-plan-navigation" aria-label="训练计划导航">
      <QueryState query={query}>
        {plan && position >= 0 ? (
          <>
            <div>
              <strong>{plan.title}</strong>
              <span>
                第 {position + 1} / {plan.total} 题 · {plan.solved} 题通过
              </span>
              {plan.archived && <Tag>已归档</Tag>}
            </div>
            <Space wrap>
              <Link to="/algorithms#my-training-plans">返回我的计划</Link>
              {position > 0 && (
                <Link to={problemLink(plan.problemIds[position - 1], plan.id)}>计划上一题</Link>
              )}
              {position + 1 < plan.problemIds.length && (
                <Link to={problemLink(plan.problemIds[position + 1], plan.id)}>计划下一题</Link>
              )}
            </Space>
          </>
        ) : (
          <Alert
            type="info"
            message={plan ? '当前题目不在这份训练计划中' : '训练计划不存在或当前学习空间不可访问'}
            action={<Link to="/algorithms">返回题库</Link>}
          />
        )}
      </QueryState>
    </section>
  );
}

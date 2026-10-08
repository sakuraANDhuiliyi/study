import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Tag } from 'antd';
import { Archive, CheckCircle2, Clock3, Plus, RefreshCw, Target, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, api, send, useData } from '../../api';
import { useAuth } from '../../auth';
import { plannerDay } from '../../planner-time';
import { EmptyState, QueryState, useUnsavedWarning } from '../shared';
import type { LearningGoal, ModuleSummary } from './types';

type GoalList = { items: LearningGoal[] };
type GoalValues = { moduleId: string; title: string; targetCount: number; dueDate?: string };
const allGoalsPath = '/academics/goals?status=all';
const goalDescription = (algorithm: boolean) =>
  algorithm
    ? '从目标创建时起，统计当前学习空间中正式提交通过的不同算法题。同一道题重复通过只计一次，运行样例与自测不计入。'
    : '从目标创建时起，统计当前学习空间中本模块标记为“已完成”的记录。继续研究的记录不计入；删除记录或改回继续研究会降低进度。';
function useGoalContext() {
  const { user } = useAuth();
  const client = useQueryClient();
  const scope = [user?.organizationId, user?.id, user?.role].join(':');
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const invalidate = () =>
    client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[1] === scope && String(query.queryKey[0]).startsWith('/academics/goals'),
    });
  return { scope, live, invalidate };
}

function GoalEditor({
  modules,
  goal,
  preselectedModuleId,
  onClose,
  onSaved,
}: {
  modules: ModuleSummary[];
  goal?: LearningGoal;
  preselectedModuleId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { live, invalidate } = useGoalContext();
  const { message } = App.useApp();
  const [form] = Form.useForm<GoalValues>();
  const initialModuleId = goal?.moduleId || preselectedModuleId;
  const selectedId = Form.useWatch('moduleId', form) || initialModuleId;
  const selected = modules.find((module) => module.id === selectedId);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [fresh, setFresh] = useState<LearningGoal | null>(null);
  const [deleted, setDeleted] = useState(false);
  useUnsavedWarning(dirty);
  async function save(revision = goal?.revision) {
    if (inFlight.current || deleted) return;
    inFlight.current = true;
    setBusy(true);
    let values: GoalValues;
    try {
      values = await form.validateFields();
    } catch {
      inFlight.current = false;
      if (live.current) setBusy(false);
      return;
    }
    if (!live.current) {
      inFlight.current = false;
      return;
    }
    setError('');
    try {
      await send(
        goal ? `/academics/goals/${goal.id}` : '/academics/goals',
        {
          ...(goal ? { revision } : { moduleId: values.moduleId }),
          title: values.title.trim(),
          targetCount: values.targetCount,
          dueDate: values.dueDate || null,
        },
        goal ? 'PATCH' : 'POST',
      );
      if (!live.current) return;
      setDirty(false);
      void invalidate();
      message.success(goal ? '学习目标已更新' : '学习目标已创建，新的学习记录将计入进度');
      onSaved();
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 409 && goal) {
        setConflict(true);
        setFresh(null);
        setError('目标已在其他页面更新。你的输入仍然保留，请刷新版本并核对后再确认保存。');
      } else if (err instanceof ApiError && err.status === 404 && goal) {
        setDeleted(true);
        setError('这个目标已不存在。你的输入仍在当前窗口，可复制后关闭。');
      } else setError((err as Error).message);
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function refreshVersion() {
    if (!goal || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await api<GoalList>(allGoalsPath);
      if (!live.current) return;
      const latest = data.items.find((item) => item.id === goal.id);
      if (!latest) {
        setDeleted(true);
        setError('这个目标已被删除。你的输入仍在当前窗口，可复制后关闭。');
      } else {
        setFresh(latest);
        setError('已读取最新版本，你的输入未被替换。核对下面的服务器内容后再确认保存。');
      }
    } catch (err) {
      if (live.current) setError(`无法刷新版本：${(err as Error).message}。你的输入已保留。`);
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={goal ? '编辑学习目标' : '创建学习目标'}
      width={600}
      onCancel={() => {
        if (!busy) onClose();
      }}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
          {!conflict && (
            <Button
              type="primary"
              aria-label={goal ? '保存目标' : '创建目标'}
              aria-busy={busy}
              loading={busy}
              disabled={busy || deleted}
              onClick={() => void save()}
            >
              {goal ? '保存目标' : '创建目标'}
            </Button>
          )}
        </>
      }
    >
      <Form
        form={form}
        layout="vertical"
        className="academic-goal-form"
        initialValues={{
          moduleId: initialModuleId,
          title:
            goal?.title ||
            (initialModuleId
              ? `${modules.find((module) => module.id === initialModuleId)?.title || '我的'}学习目标`
              : ''),
          targetCount: goal?.targetCount ?? 3,
          dueDate: goal?.dueDate || '',
        }}
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item
          name="moduleId"
          label="学习模块"
          rules={[{ required: true, message: '请选择一个学习模块' }]}
        >
          <Select
            aria-label="学习模块"
            showSearch
            optionFilterProp="label"
            disabled={!!goal || busy}
            placeholder="选择本次专注的模块"
            options={modules.map((module) => ({ value: module.id, label: module.title }))}
            onChange={(id) => {
              const module = modules.find((item) => item.id === id);
              if (module) form.setFieldValue('title', `${module.title}学习目标`);
            }}
          />
        </Form.Item>
        <Form.Item
          name="title"
          label="目标标题"
          rules={[
            { required: true, whitespace: true, message: '请填写目标标题' },
            { max: 160, message: '目标标题最多160字符' },
          ]}
        >
          <Input
            aria-label="目标标题"
            maxLength={160}
            disabled={busy}
            placeholder="例如：完成三次电路参数对照实验"
          />
        </Form.Item>
        <div className="academic-goal-form-row">
          <Form.Item
            name="targetCount"
            label="目标数量"
            rules={[
              { required: true, message: '请填写目标数量' },
              { type: 'integer', min: 1, max: 1000, message: '请输入1至1000的整数' },
            ]}
          >
            <InputNumber
              aria-label="目标数量"
              min={1}
              max={1000}
              precision={0}
              disabled={busy}
              addonAfter={selected?.kind === 'algorithm' ? '题' : '次'}
            />
          </Form.Item>
          <Form.Item name="dueDate" label="截止日期（北京时间，可选）">
            <Input
              aria-label="截止日期（北京时间，可选）"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              disabled={busy}
            />
          </Form.Item>
        </div>
        <p className="academic-goal-method">{goalDescription(selected?.kind === 'algorithm')}</p>
        <p className="form-hint">
          截止日期按北京时间的自然日判断；当日仍可完成。每个学习空间最多保存100个目标。
        </p>
      </Form>
      {error && <Alert showIcon type={conflict && !deleted ? 'warning' : 'error'} message={error} />}
      {conflict && !deleted && (
        <div className="academic-goal-conflict">
          <Button
            aria-label="保留输入并刷新版本"
            loading={busy}
            disabled={busy}
            onClick={() => void refreshVersion()}
          >
            保留输入并刷新版本
          </Button>
          {fresh && (
            <>
              <div className="academic-goal-server-version">
                <strong>服务器最新内容</strong>
                <p>{fresh.title}</p>
                <p>
                  目标 {fresh.targetCount} {fresh.unit} ·{' '}
                  {fresh.dueDate ? `截止 ${fresh.dueDate}` : '未设置期限'} ·{' '}
                  {fresh.archived ? '已归档' : '当前目标'}
                </p>
                <p>
                  已完成 {fresh.progressCount} {fresh.unit}，保存设置不会新增学习记录或更改归档状态。
                </p>
              </div>
              <Popconfirm
                title="按最新版本保存当前输入？"
                description="将更新标题、目标数量与日期，请先核对服务器内容。"
                okText="确认保存"
                cancelText="继续核对"
                onConfirm={() => save(fresh.revision)}
              >
                <Button type="primary" disabled={busy}>
                  按最新版本保存我的输入
                </Button>
              </Popconfirm>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function GoalCreateButton({ module }: { module: ModuleSummary }) {
  const [open, setOpen] = useState(false);
  const { scope } = useGoalContext();
  return (
    <>
      <Button icon={<Target size={16} />} onClick={() => setOpen(true)}>
        创建本模块目标
      </Button>
      {open && (
        <GoalEditor
          key={scope}
          modules={[module]}
          preselectedModuleId={module.id}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  );
}

function deadline(goal: LearningGoal) {
  if (!goal.dueDate) return '未设置期限';
  if (goal.completed || goal.archived) return `截止 ${goal.dueDate}`;
  if (goal.overdue) return `已过期 · ${goal.dueDate}`;
  const days = Math.round(
    (Date.parse(`${goal.dueDate}T00:00:00+08:00`) - Date.parse(`${plannerDay()}T00:00:00+08:00`)) / 86400000,
  );
  return days === 0
    ? '今天到期（北京时间）'
    : days > 0 && days <= 3
      ? `${days}天后到期 · ${goal.dueDate}`
      : `截止 ${goal.dueDate}`;
}

export function LearningGoals({ modules }: { modules: ModuleSummary[] }) {
  const { user } = useAuth();
  return <GoalBoard key={[user?.organizationId, user?.id, user?.role].join(':')} modules={modules} />;
}
function GoalBoard({ modules }: { modules: ModuleSummary[] }) {
  const { live, invalidate } = useGoalContext();
  const { message } = App.useApp();
  const [status, setStatus] = useState('active');
  const query = useData<GoalList>(`/academics/goals?status=${status}`, true, 30000);
  const refetch = query.refetch;
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const [editing, setEditing] = useState<LearningGoal | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const actionBusy = useRef(false);
  async function action(goal: LearningGoal, remove = false) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    setBusyId(goal.id);
    setError('');
    try {
      await send(
        `/academics/goals/${goal.id}`,
        { revision: goal.revision, ...(!remove ? { archived: !goal.archived } : {}) },
        remove ? 'DELETE' : 'PATCH',
      );
      if (!live.current) return;
      void invalidate();
      message.success(remove ? '目标已删除，原学习记录保留' : goal.archived ? '目标已恢复' : '目标已归档');
    } catch (err) {
      if (!live.current) return;
      setError(
        err instanceof ApiError && err.status === 409
          ? '这个目标已在其他页面更新。请刷新列表、核对最新内容后再次操作。'
          : (err as Error).message,
      );
      if (err instanceof ApiError && [409, 404].includes(err.status)) void invalidate();
    } finally {
      actionBusy.current = false;
      if (live.current) setBusyId('');
    }
  }
  const items = query.data?.items || [];
  return (
    <section className="academic-goals panel" aria-label="我的学习目标">
      <div className="academic-section-heading">
        <div>
          <h2>
            <Target size={20} /> 我的学习目标
          </h2>
          <p>为一个模块设定可完成的目标，让新的学习记录积累为真实进度。</p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          disabled={!modules.length}
          onClick={() => setEditing('new')}
        >
          创建学习目标
        </Button>
      </div>
      <div className="academic-goal-toolbar">
        <Select
          aria-label="学习目标状态"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: '当前目标' },
            { value: 'archived', label: '已归档' },
            { value: 'all', label: '全部目标' },
          ]}
        />
        <Button
          icon={<RefreshCw size={14} />}
          aria-label="刷新目标"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新目标
        </Button>
        <span>{query.data ? `${items.length} 个目标` : '正在读取目标'}</span>
      </div>
      {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
      <QueryState query={query}>
        {items.length ? (
          <div className="academic-goal-grid">
            {items.map((goal) => {
              const module = modules.find((item) => item.id === goal.moduleId);
              const percentage = Math.min(100, Math.max(0, (goal.progressCount / goal.targetCount) * 100));
              return (
                <article
                  key={goal.id}
                  data-testid={`academic-goal-${goal.id}`}
                  className={`academic-goal-card${goal.completed ? ' is-complete' : ''}${goal.archived ? ' is-archived' : ''}`}
                >
                  <div className="academic-goal-state">
                    <Tag>{module?.title || '学习模块'}</Tag>
                    {goal.archived && <Tag>已归档</Tag>}
                    {goal.completed ? (
                      <Tag color="green">
                        <CheckCircle2 size={12} /> 已完成
                      </Tag>
                    ) : goal.overdue && !goal.archived ? (
                      <Tag color="orange">已过期</Tag>
                    ) : (
                      <Tag color="blue">进行中</Tag>
                    )}
                  </div>
                  <h3>{goal.title}</h3>
                  <div className="academic-goal-count">
                    <strong>
                      {goal.progressCount} / {goal.targetCount} {goal.unit}
                    </strong>
                    <span>
                      {goal.completed
                        ? '已达到目标'
                        : `还需 ${Math.max(0, goal.targetCount - goal.progressCount)} ${goal.unit}`}
                    </span>
                  </div>
                  <div
                    className="academic-goal-progress"
                    role="progressbar"
                    aria-label={`${goal.title}进度`}
                    aria-valuemin={0}
                    aria-valuemax={goal.targetCount}
                    aria-valuenow={Math.min(goal.progressCount, goal.targetCount)}
                    aria-valuetext={`已完成${goal.progressCount}${goal.unit}，目标${goal.targetCount}${goal.unit}`}
                  >
                    <span style={{ width: `${percentage}%` }} />
                  </div>
                  <p
                    className={`academic-goal-deadline${goal.overdue && !goal.completed && !goal.archived ? ' is-overdue' : ''}`}
                  >
                    <Clock3 size={14} />
                    {deadline(goal)}
                  </p>
                  <p className="academic-goal-method">{goalDescription(goal.unit === '题')}</p>
                  <div className="academic-goal-actions">
                    {!goal.archived && (
                      <Link
                        to={
                          goal.moduleId === 'algorithms'
                            ? '/algorithms'
                            : `/academics/modules/${goal.moduleId}`
                        }
                      >
                        <Button size="small" type="primary">
                          继续学习
                        </Button>
                      </Link>
                    )}
                    <Button
                      size="small"
                      aria-label={`编辑目标 ${goal.title}`}
                      disabled={!!busyId}
                      onClick={() => setEditing(goal)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      icon={<Archive size={13} />}
                      aria-label={`${goal.archived ? '恢复' : '归档'}目标 ${goal.title}`}
                      disabled={!!busyId}
                      loading={busyId === goal.id}
                      onClick={() => void action(goal)}
                    >
                      {goal.archived ? '恢复' : '归档'}
                    </Button>
                    <Popconfirm
                      title="删除这个学习目标？"
                      description="只删除目标，已有学习记录和算法提交会保留。"
                      okText="删除目标"
                      cancelText="保留目标"
                      onConfirm={() => action(goal, true)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<Trash2 size={13} />}
                        aria-label={`删除目标 ${goal.title}`}
                        disabled={!!busyId}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            description={
              status === 'archived'
                ? '还没有归档的目标。'
                : '还没有学习目标。选一个模块，设定一个小目标开始吧。'
            }
          />
        )}
      </QueryState>
      {editing && (
        <GoalEditor
          modules={modules}
          goal={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}

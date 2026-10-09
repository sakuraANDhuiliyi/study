import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Pagination, Spin, Tag } from 'antd';
import { Check, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError, getCsrf, queryString } from '../../api';
import type { User } from '../../api';
import { useAuth } from '../../auth';
import { EmptyState } from '../shared';
import './learning-actions.css';

type Bucket = 'today' | 'upcoming' | 'overdue';
type ActionItem = {
  id: string;
  type: 'personal' | 'assignment' | 'exam';
  title: string;
  dueAt: string;
  originalDueAt?: string;
  startsAt?: string;
  courseId?: string;
  courseTitle?: string;
  revision?: number;
  overdue: boolean;
  status: string;
  action: 'complete_task' | 'view' | 'resubmit' | 'submit' | 'continue_exam' | 'wait_exam' | 'start_exam';
  actionLabel: string;
  path: string;
  reason: 'deadline_passed' | 'attempt_limit' | 'exam_not_started' | null;
};
type ActionsResponse = {
  items: ActionItem[];
  counts: Record<Bucket, number>;
  total: number;
  page: number;
  pageSize: number;
  bucket: Bucket;
  timezone: 'Asia/Shanghai';
  serverTime: string;
  range: { todayStart: string; tomorrowStart: string; upcomingEnd: string };
};
// Cache objects can survive route changes. Weak keys keep a known rejected
// snapshot rejected across remounts without retaining personal rows or sessions.
const deniedSnapshots = new WeakMap<ActionsResponse, ApiError>();
const buckets: { key: Bucket; label: string; empty: string }[] = [
  { key: 'today', label: '今日', empty: '今天余下时间没有待处理的学习行动。' },
  { key: 'upcoming', label: '未来7天', empty: '从明天起的7天内没有待处理的学习行动。' },
  { key: 'overdue', label: '逾期', empty: '没有已过计划或截止时间的未完成行动。' },
];
const labels: Record<string, string> = {
  pending: '待完成',
  overdue: '已逾期',
  not_submitted: '待提交',
  returned: '待重交',
  closed: '已截止',
  upcoming: '尚未开始',
  in_progress: '作答中',
  available: '可进入',
};
const types = { personal: '个人待办', assignment: '作业', exam: '考试' };
const reasons: Record<string, string> = {
  deadline_passed: '已超过当前截止时间，请联系教师处理延期。',
  attempt_limit: '提交次数已用完，请联系教师处理追加次数。',
  exam_not_started: '考试尚未开始，可先查看安排。',
};
const timestamp = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
const ownerOf = (user?: User) => [user?.organizationId, user?.id, user?.role].join(':');
const permissionsOf = (user?: User) => [...(user?.permissions ?? [])].sort().join(',');
const timeLabel = (item: ActionItem) =>
  item.type === 'personal'
    ? '计划时间'
    : item.type === 'assignment'
      ? '当前截止'
      : item.action === 'continue_exam'
        ? '答卷截止'
        : item.action === 'wait_exam'
          ? '考试开始'
          : '进入截止';
function safePath(item: ActionItem) {
  if (item.type === 'personal') return '/planner';
  if (!/^\/(?:assignments|exams|exam-attempts)\/[a-zA-Z0-9_-]+$/.test(item.path)) return null;
  if (item.type === 'assignment') return item.path.startsWith('/assignments/') ? item.path : null;
  return item.action === 'continue_exam'
    ? item.path.startsWith('/exam-attempts/')
      ? item.path
      : null
    : item.path.startsWith('/exams/')
      ? item.path
      : null;
}

/** Shared by the organization student dashboard and the personal learning home. */
export function ActionPanel() {
  const { user } = useAuth();
  if (user?.role !== 'STUDENT' || !user.permissions.includes('learning.use')) return null;
  return <ActionPanelContent key={`${ownerOf(user)}:${getCsrf()}:${permissionsOf(user)}`} />;
}

function ActionPanelContent() {
  const { user } = useAuth();
  const client = useQueryClient();
  const { message } = App.useApp();
  const owner = ownerOf(user);
  const csrf = getCsrf();
  const permissions = permissionsOf(user);
  const [bucket, setBucket] = useState<Bucket>('today');
  const [page, setPage] = useState(1);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const expiredRef = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const operation = useRef(false);
  const readDenial = useRef<{ error: ApiError } | null>(null);
  const tabRefs = useRef<Partial<Record<Bucket, HTMLButtonElement>>>({});
  const identifier = useId();
  const scope = useMemo(
    () => ['/planner/actions', owner, csrf, permissions] as const,
    [owner, csrf, permissions],
  );

  function isCurrent() {
    const current = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expiredRef.current &&
      !!current &&
      ownerOf(current) === owner &&
      getCsrf() === csrf &&
      permissionsOf(current) === permissions &&
      current.role === 'STUDENT' &&
      current.permissions.includes('learning.use')
    );
  }
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      generation.current++;
      expiredRef.current = true;
      setExpired(true);
      void client.cancelQueries({ queryKey: scope });
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      mounted.current = false;
      generation.current++;
      window.removeEventListener('auth-expired', expire);
    };
    // A scope change remounts the content. Pagination does not expire its session.
  }, [client, scope]);

  const query = useQuery<ActionsResponse>({
    queryKey: [...scope, bucket, page],
    queryFn: async ({ signal }) => {
      const issued = generation.current;
      try {
        const response = await api<ActionsResponse>(
          `/planner/actions?${queryString({ bucket, page, pageSize: 10 })}`,
          { signal },
        );
        // api() intentionally returns ordinary stale 200 bodies. Reject them before
        // React Query can cache any private counts or rows in the current component.
        if (!isCurrent() || signal.aborted || issued !== generation.current)
          throw new DOMException('学习行动请求已失效', 'AbortError');
        return response;
      } catch (error) {
        if (
          error instanceof ApiError &&
          [401, 403].includes(error.status) &&
          isCurrent() &&
          issued === generation.current
        ) {
          // A denied read also revokes other cached buckets/pages in this scope.
          // New reads can recover independently; earlier in-flight reads cannot.
          generation.current++;
          for (const [, snapshot] of client.getQueriesData<ActionsResponse>({ queryKey: scope }))
            if (snapshot) deniedSnapshots.set(snapshot, error);
          readDenial.current = { error };
          void client.invalidateQueries({ queryKey: scope, refetchType: 'none' });
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    // A freshly authorized body must not reuse a previously denied snapshot.
    structuralSharing: false,
    refetchInterval: 60000,
  });
  // Membership and audience can change without changing owner, CSRF or the
  // permission list. A denied fresh read must never keep its older private rows.
  const snapshotDenial = query.data ? deniedSnapshots.get(query.data) : undefined;
  const blockedSnapshot = !!snapshotDenial || (!query.data && !!readDenial.current);
  const readError = snapshotDenial ?? (blockedSnapshot ? readDenial.current!.error : query.error);
  const denied = readError instanceof ApiError && [401, 403].includes(readError.status);
  const data = denied || blockedSnapshot ? undefined : query.data;
  useEffect(() => {
    if (data) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, page]);

  function changeBucket(value: Bucket) {
    if (operation.current) return;
    setBucket(value);
    setPage(1);
    setActionError(null);
  }
  function onTabKey(event: React.KeyboardEvent<HTMLButtonElement>, current: Bucket) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || operation.current) return;
    event.preventDefault();
    const index = buckets.findIndex((item) => item.key === current);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buckets.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buckets.length) % buckets.length;
    changeBucket(buckets[next].key);
    tabRefs.current[buckets[next].key]?.focus();
  }
  async function refresh() {
    await client.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/planner'),
    });
  }
  async function complete(item: ActionItem) {
    if (
      operation.current ||
      !isCurrent() ||
      item.type !== 'personal' ||
      item.action !== 'complete_task' ||
      !Number.isInteger(item.revision)
    )
      return;
    operation.current = true;
    const issued = generation.current;
    const current = () => isCurrent() && issued === generation.current;
    setPendingId(item.id);
    setActionError(null);
    try {
      await api(`/planner/tasks/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision: item.revision, completed: true }),
      });
      if (!current()) return;
      await refresh();
      if (current()) message.success('个人待办已完成');
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && [409, 404].includes(error.status)) {
        setActionError(
          error.status === 409
            ? '待办已在其他页面修改，已刷新清单。请核对当前内容后再次完成。'
            : '待办已删除或不再可访问，已刷新清单。',
        );
        await refresh();
      } else if (error instanceof ApiError && error.status === 403) {
        setActionError('当前已无权完成此待办，请重新确认当前权限。');
        await refresh();
      } else setActionError(error instanceof Error ? error.message : '操作失败，请刷新后重试。');
    } finally {
      operation.current = false;
      if (isCurrent()) setPendingId(null);
    }
  }
  if (expired || !isCurrent()) return null;
  const selected = buckets.find((item) => item.key === bucket)!;
  return (
    <section className="learning-actions panel" aria-labelledby={`${identifier}-heading`}>
      <div className="learning-actions-heading">
        <div>
          <h2 id={`${identifier}-heading`}>我的学习行动清单</h2>
          <p>
            {user?.permissions.includes('course.read')
              ? '作业、考试与个人待办，按当前个人安排汇总。'
              : '汇总本人个人待办；当前没有课程查看权限。'}
          </p>
        </div>
        <Link to="/planner">
          安排个人待办 <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="learning-action-tabs" role="tablist" aria-label="学习行动时间范围">
        {buckets.map((item) => (
          <button
            key={item.key}
            ref={(node) => {
              if (node) tabRefs.current[item.key] = node;
            }}
            id={`${identifier}-${item.key}`}
            type="button"
            role="tab"
            aria-selected={bucket === item.key}
            aria-controls={`${identifier}-content`}
            tabIndex={bucket === item.key ? 0 : -1}
            disabled={pendingId !== null}
            onClick={() => changeBucket(item.key)}
            onKeyDown={(event) => onTabKey(event, item.key)}
          >
            {item.label} <span>{data ? data.counts[item.key] : '—'}</span>
          </button>
        ))}
      </div>
      <div
        id={`${identifier}-content`}
        role="tabpanel"
        aria-labelledby={`${identifier}-${bucket}`}
        className="learning-actions-content"
        aria-busy={query.isFetching}
      >
        {data && (
          <p className="learning-action-range">
            {bucket === 'today'
              ? `今日：从 ${timestamp(data.serverTime)} 至 ${timestamp(data.range.tomorrowStart)}（不含）。今天已到时的行动归入逾期。`
              : bucket === 'upcoming'
                ? `未来7天：从 ${timestamp(data.range.tomorrowStart)} 至 ${timestamp(data.range.upcomingEnd)}（不含），不包含今天。`
                : `逾期：计划或当前截止时间早于 ${timestamp(data.serverTime)} 的未完成行动，按最近到时优先。`}{' '}
            所有时间均为北京时间。
          </p>
        )}
        {actionError && <Alert type="warning" showIcon message={actionError} />}
        {(query.isLoading || (blockedSnapshot && query.isFetching)) && (
          <div className="learning-actions-loading" role="status" aria-label="学习行动加载状态">
            <Spin size="small" /> 正在载入学习行动…
          </div>
        )}
        {readError && (
          <Alert
            type="error"
            showIcon
            message={
              denied
                ? readError instanceof ApiError && readError.status === 403
                  ? '无权访问学习行动清单，请确认当前权限'
                  : '当前登录已失效，请重新登录'
                : data
                  ? '暂时无法刷新，正在显示上次加载的清单'
                  : '暂时无法加载学习行动'
            }
            description={readError instanceof Error ? readError.message : undefined}
            action={
              <Button size="small" aria-label="重试加载学习行动" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        )}
        {data && (
          <>
            <p className="learning-action-count" role="status" aria-label="行动匹配数量">
              {selected.label}共 {data.total} 项{data.total > 0 ? ` · 第 ${data.page} 页` : ''}
              {query.isFetching && ' · 正在刷新'}
            </p>
            {data.items.length ? (
              <ul className="learning-action-list" aria-label={`${selected.label}学习行动`}>
                {data.items.map((item) => {
                  const path = safePath(item);
                  return (
                    <li
                      key={`${item.type}:${item.id}`}
                      data-testid={`learning-action-${item.type}-${item.id}`}
                    >
                      <div className="learning-action-summary">
                        <div className="learning-action-meta">
                          <span>{types[item.type]}</span>
                          <Tag
                            color={
                              item.overdue ? 'orange' : item.status === 'in_progress' ? 'blue' : undefined
                            }
                          >
                            {labels[item.status] || item.status}
                          </Tag>
                        </div>
                        <h3>{item.title}</h3>
                        {item.courseTitle && <p>{item.courseTitle}</p>}
                        <p>
                          {timeLabel(item)}：<time dateTime={item.dueAt}>{timestamp(item.dueAt)}</time>
                        </p>
                        {item.originalDueAt && item.originalDueAt !== item.dueAt && (
                          <p>原截止：{timestamp(item.originalDueAt)}；已采用你的个人延期安排。</p>
                        )}
                        {item.reason && <p className="learning-action-reason">{reasons[item.reason]}</p>}
                      </div>
                      {item.type === 'personal' && item.action === 'complete_task' ? (
                        <Button
                          icon={<Check size={14} aria-hidden="true" />}
                          aria-label={`标为完成 ${item.title}`}
                          loading={pendingId === item.id}
                          disabled={!!pendingId || query.isError || !Number.isInteger(item.revision)}
                          onClick={() => void complete(item)}
                        >
                          标为完成
                        </Button>
                      ) : path ? (
                        <Link to={path} className="learning-action-open">
                          {item.actionLabel}
                          <ChevronRight size={14} aria-hidden="true" />
                        </Link>
                      ) : (
                        <span>请在学习日历查看安排</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState description={selected.empty} />
            )}
            <Pagination
              size="small"
              current={page}
              total={data.total}
              pageSize={10}
              showSizeChanger={false}
              hideOnSinglePage
              disabled={pendingId !== null}
              onChange={(value) => {
                setPage(value);
                setActionError(null);
              }}
            />
          </>
        )}
      </div>
      <div className="learning-actions-footer">
        <Link to="/planner">查看学习日历</Link>
        <Button
          size="small"
          icon={<RefreshCw size={14} aria-hidden="true" />}
          aria-label="刷新学习行动清单"
          disabled={pendingId !== null || query.isFetching}
          onClick={() => {
            setActionError(null);
            void query.refetch();
          }}
        >
          刷新
        </Button>
      </div>
    </section>
  );
}

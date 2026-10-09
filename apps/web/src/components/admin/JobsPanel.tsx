import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Spin, Table, Tag } from 'antd';
import { ApiError, getCsrf, queryString, type User } from '../../api';
import { useAuth } from '../../auth';
import './jobs.css';

type JobStatus = 'ALL' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
type JobFilters = { action: string; status: JobStatus };
type JobRecord = {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: string;
  status: string;
  attempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
};
type JobsResponse = {
  items: JobRecord[];
  total: number;
  page: number;
  pageSize: number;
  stateCounts: {
    all: number;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    other: number;
  };
  scope: 'platform_institutions' | 'current_organization';
  serverTime: string;
  // Existing independent platform-only runs are not BackgroundJob rows or facets.
  examDeadlineRuns: unknown[];
};
const options: { value: JobStatus; label: string }[] = [
  { value: 'ALL', label: '全部状态' },
  { value: 'PENDING', label: '待处理' },
  { value: 'RUNNING', label: '运行中' },
  { value: 'SUCCEEDED', label: '已完成' },
  { value: 'FAILED', label: '失败' },
];
const countLabels = {
  all: '全部',
  pending: '待处理',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  other: '其他状态',
};
const blank = (): JobFilters => ({ action: '', status: 'ALL' });
const ownerOf = (user?: User) => JSON.stringify([user?.organizationId, user?.id, user?.role]);
const authorizationOf = (user?: User) =>
  JSON.stringify([
    user?.organizationId,
    user?.id,
    user?.role,
    user?.accountMode,
    [...(user?.roles ?? [])].sort(),
    [...(user?.permissions ?? [])].sort(),
  ]);
const rejectedSnapshots = new WeakMap<JobsResponse, ApiError>();
const rejected = (failure: unknown): failure is ApiError =>
  failure instanceof ApiError && failure.status >= 400 && failure.status < 500;
const timestamp = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    : '—';

export function JobsPanel() {
  const { user } = useAuth();
  if (!user?.permissions.includes('audit.read'))
    return <Alert type="error" showIcon message="当前无权查看后台任务" />;
  return (
    <JobsPanelContent
      key={authorizationOf(user) + ':' + getCsrf()}
      owner={ownerOf(user)}
      authorization={authorizationOf(user)}
      csrf={getCsrf()}
      platform={user.permissions.includes('org.platform')}
    />
  );
}

function JobsPanelContent({
  owner,
  authorization,
  csrf,
  platform,
}: {
  owner: string;
  authorization: string;
  csrf: string;
  platform: boolean;
}) {
  const client = useQueryClient();
  const identifier = useId();
  const [draft, setDraft] = useState<JobFilters>(blank);
  const [filters, setFilters] = useState<JobFilters>(blank);
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState('');
  const [expired, setExpired] = useState(false);
  const mounted = useRef(true);
  const expiredRef = useRef(false);
  const generation = useRef(0);
  const denial = useRef<ApiError | null>(null);
  const scope = useMemo(
    () => ['/admin/jobs', owner, authorization, csrf] as const,
    [owner, authorization, csrf],
  );
  const serialized = queryString(filters);
  function current() {
    const user = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expiredRef.current &&
      !!user &&
      ownerOf(user) === owner &&
      authorizationOf(user) === authorization &&
      getCsrf() === csrf &&
      user.permissions.includes('audit.read') &&
      user.permissions.includes('org.platform') === platform
    );
  }
  function rejectCached(failure: ApiError) {
    generation.current++;
    for (const [, data] of client.getQueriesData<JobsResponse>({ queryKey: scope }))
      if (data) rejectedSnapshots.set(data, failure);
    denial.current = failure;
    void client.invalidateQueries({ queryKey: scope, refetchType: 'none' });
  }
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      rejectCached(new ApiError(401, '当前登录已失效'));
      expiredRef.current = true;
      setExpired(true);
      void client.cancelQueries({ queryKey: scope });
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      // Restoring the exact previous grant signature must not revive a snapshot
      // from before its revocation, including a same-owner/same-CSRF change.
      if (!current()) {
        const changed = new ApiError(409, '任务访问范围已变化，请重新载入。');
        for (const [, data] of client.getQueriesData<JobsResponse>({ queryKey: scope }))
          if (data) rejectedSnapshots.set(data, changed);
      }
      mounted.current = false;
      generation.current++;
      window.removeEventListener('auth-expired', expire);
    };
  }, [client, scope]);
  const query = useQuery<JobsResponse>({
    queryKey: [...scope, serialized, page],
    queryFn: async ({ signal }) => {
      const issued = generation.current;
      const active = () => current() && !signal.aborted && issued === generation.current;
      try {
        // Domain-local fetch checks permission-only changes before processing401.
        const response = await fetch('/api/admin/jobs?' + queryString({ ...filters, page, pageSize: 20 }), {
          credentials: 'include',
          signal,
        });
        if (!active()) throw new DOMException('后台任务请求已失效', 'AbortError');
        const body = await response.json().catch(() => ({}));
        if (!active()) throw new DOMException('后台任务请求已失效', 'AbortError');
        if (!response.ok) {
          const description = body.message || body.error?.message;
          const failure = new ApiError(
            response.status,
            Array.isArray(description)
              ? description.join('；').slice(0, 600)
              : typeof description === 'string'
                ? description.slice(0, 600)
                : '暂时无法加载后台任务',
            body.error?.requestId || body.requestId,
          );
          if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
          throw failure;
        }
        // Old responses without server aggregates must not be turned into zero
        // or counts calculated from the current page.
        if (!body.stateCounts || body.scope !== (platform ? 'platform_institutions' : 'current_organization'))
          throw new ApiError(502, '后台任务统计响应不完整，请刷新重试。');
        denial.current = null;
        return body as JobsResponse;
      } catch (failure) {
        if (rejected(failure) && active()) rejectCached(failure);
        throw failure;
      }
    },
    retry: false,
    structuralSharing: false,
    staleTime: 0,
  });
  const priorDenial = query.data ? rejectedSnapshots.get(query.data) : undefined;
  const blocked = !!priorDenial || (!query.data && !!denial.current);
  const error = priorDenial ?? (blocked ? denial.current : query.error);
  const data = !current() || blocked || rejected(error) ? undefined : query.data;
  useEffect(() => {
    if (data) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, page]);
  function apply() {
    if (draft.action.length > 200 || draft.action.includes('\0')) {
      setFilterError('任务类型关键词最多200字，不能包含空字符。');
      return;
    }
    setFilters({ ...draft });
    setPage(1);
    setFilterError('');
  }
  if (expired || !current()) return null;
  return (
    <section className="jobs-panel" aria-labelledby={identifier + '-title'}>
      <h2 id={identifier + '-title'}>后台任务记录</h2>
      <form
        className="jobs-filters"
        aria-label="后台任务筛选"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label>
          <span>任务类型关键词</span>
          <Input
            aria-label="任务类型关键词"
            value={draft.action}
            maxLength={200}
            allowClear
            placeholder="如 NOTIFICATION 或 ASSIGNMENT_EXPORT"
            onChange={(event) => setDraft((value) => ({ ...value, action: event.target.value }))}
          />
        </label>
        <label>
          <span>任务状态</span>
          <select
            aria-label="任务状态"
            value={draft.status}
            onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as JobStatus }))}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="jobs-filter-actions">
          <Button type="primary" htmlType="submit">
            应用任务筛选
          </Button>
          <Button
            onClick={() => {
              setDraft(blank());
              setFilters(blank());
              setPage(1);
              setFilterError('');
            }}
          >
            重置任务筛选
          </Button>
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
            刷新后台任务
          </Button>
        </div>
        <p className="jobs-hint">
          关键词只匹配任务类型，不区分大小写，百分号、下划线和反斜杠按字面匹配。空白属于关键词，不检索任务正文。筛选编辑后点击应用。
        </p>
      </form>
      {filterError && <Alert type="error" showIcon message="任务筛选未应用" description={filterError} />}
      <div className="jobs-applied" aria-label="已应用的任务筛选">
        <strong>已应用：</strong>
        <Tag>任务类型：{filters.action || '全部类型'}</Tag>
        <Tag>状态：{options.find((option) => option.value === filters.status)?.label}</Tag>
      </div>
      <p role="status" aria-label="任务查询范围" className="jobs-scope">
        {platform
          ? '所有机构：包含停用机构的历史任务，排除个人空间。'
          : '当前机构：仅查看当前机构的后台任务。'}
      </p>
      {(query.isLoading || (blocked && query.isFetching)) && (
        <p role="status" aria-label="后台任务加载状态">
          <Spin size="small" /> 正在加载后台任务…
        </p>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={
            rejected(error)
              ? error.status === 401
                ? '当前登录已失效'
                : '无权查看后台任务，请确认当前权限'
              : data
                ? '暂时无法刷新，正在显示上次载入的后台任务'
                : '暂时无法加载后台任务'
          }
          description={error instanceof Error ? error.message : undefined}
          action={
            <Button size="small" aria-label="重试加载后台任务" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {data && (
        <>
          <div role="status" aria-label="任务状态概览" className="jobs-overview">
            <p>状态概览按已应用的类型关键词和上述机构范围统计全部状态，不受列表状态或分页影响。</p>
            <dl className="jobs-counts">
              {(Object.keys(countLabels) as (keyof typeof countLabels)[]).map((key) => (
                <div key={key}>
                  <dt>{countLabels[key]}</dt>
                  <dd data-testid={'jobs-count-' + key}>{data.stateCounts[key]}</dd>
                </div>
              ))}
            </dl>
            <p className="jobs-hint">
              截至服务器北京时间 {timestamp(data.serverTime)}
              。待处理任务可能带有最近错误；失败状态表示该任务的当前状态。
            </p>
          </div>
          <p role="status" aria-label="任务匹配数量">
            当前列表共 {data.total} 项后台任务；第 {data.page} 页。考试截止处理运行记录不计入任务概览。
          </p>
          <div className="jobs-table-region" role="region" aria-label="后台任务列表" tabIndex={0}>
            <Table<JobRecord>
              rowKey="id"
              dataSource={data.items}
              onRow={(record) =>
                ({ 'data-testid': 'jobs-row-' + record.id }) as React.HTMLAttributes<HTMLTableRowElement>
              }
              scroll={{ x: 1100 }}
              locale={{ emptyText: '没有符合筛选的后台任务' }}
              columns={[
                {
                  title: '所属机构',
                  width: 210,
                  render: (_, record) => (
                    <div className="jobs-text">
                      <strong>{record.organizationName}</strong>
                      <small>{record.organizationId}</small>
                    </div>
                  ),
                },
                {
                  title: '任务类型',
                  dataIndex: 'kind',
                  width: 220,
                  render: (value) => <span className="jobs-text">{value}</span>,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (value) => (
                    <Tag>{options.find((option) => option.value === value)?.label ?? value}</Tag>
                  ),
                },
                { title: '尝试次数', dataIndex: 'attempts', width: 100 },
                { title: '计划运行时间（北京时间）', dataIndex: 'runAt', width: 190, render: timestamp },
                { title: '创建时间（北京时间）', dataIndex: 'createdAt', width: 190, render: timestamp },
                {
                  title: '最近错误',
                  dataIndex: 'lastError',
                  width: 260,
                  render: (value) => <span className="jobs-text">{value || '—'}</span>,
                },
              ]}
              pagination={{
                current: page,
                pageSize: 20,
                total: data.total,
                onChange: setPage,
                showSizeChanger: false,
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}

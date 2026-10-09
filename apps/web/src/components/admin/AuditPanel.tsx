import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Spin, Table, Tag } from 'antd';
import { Download, RefreshCw } from 'lucide-react';
import { api, ApiError, getCsrf, queryString, type User } from '../../api';
import { useAuth } from '../../auth';
import { AuditExport } from './AuditExport';
import {
  auditFilterLabels,
  auditTimestamp,
  parseAuditDraft,
  type AuditFilters,
  type AuditResponse,
  type AuditExportSnapshot,
} from './audit.types';
import './audit.css';

// A known rejected snapshot remains rejected when a cached filter/page is remounted.
// Weak keys avoid retaining personal log contents or identities beyond Query's cache.
const rejectedSnapshots = new WeakMap<AuditResponse, ApiError>();
const blankDraft = (): Record<keyof AuditFilters, string> => ({
  search: '',
  action: '',
  actorId: '',
  resourceType: '',
  resourceId: '',
  requestId: '',
  from: '',
  to: '',
});
const ownerOf = (user?: User) => JSON.stringify([user?.organizationId, user?.id, user?.role]);
// Include all selected-role/effective-permission fields exposed by /auth/me.
// Grant revocation is reflected in effective permissions, and CSV is reauthorized by the server.
const authorizationOf = (user?: User) =>
  JSON.stringify([
    user?.organizationId,
    user?.id,
    user?.role,
    user?.accountMode,
    [...(user?.roles ?? [])].sort(),
    [...(user?.permissions ?? [])].sort(),
  ]);
const readRejected = (failure: unknown): failure is ApiError =>
  failure instanceof ApiError && failure.status >= 400 && failure.status < 500;

export function AuditPanel() {
  const { user } = useAuth();
  if (!user?.permissions.includes('audit.read'))
    return <Alert type="error" showIcon message="当前无权查看机构审计" />;
  return (
    <AuditPanelContent
      key={`${authorizationOf(user)}:${getCsrf()}`}
      owner={ownerOf(user)}
      authorization={authorizationOf(user)}
      csrf={getCsrf()}
      canExport={user.permissions.includes('data.export')}
    />
  );
}

function AuditPanelContent({
  owner,
  authorization,
  csrf,
  canExport,
}: {
  owner: string;
  authorization: string;
  csrf: string;
  canExport: boolean;
}) {
  const client = useQueryClient();
  const identifier = useId();
  const [draft, setDraft] = useState(blankDraft);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState('');
  const [snapshot, setSnapshot] = useState<AuditExportSnapshot | null>(null);
  const [expired, setExpired] = useState(false);
  const expiredRef = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const readRejection = useRef<ApiError | null>(null);
  const scope = useMemo(
    () => ['/admin/audit', owner, authorization, csrf] as const,
    [owner, authorization, csrf],
  );
  const serialized = queryString(filters);
  function isCurrent() {
    const current = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expiredRef.current &&
      !!current &&
      ownerOf(current) === owner &&
      authorizationOf(current) === authorization &&
      getCsrf() === csrf &&
      current.permissions.includes('audit.read')
    );
  }
  function rejectCached(failure: ApiError) {
    generation.current++;
    for (const [, data] of client.getQueriesData<AuditResponse>({ queryKey: scope }))
      if (data) rejectedSnapshots.set(data, failure);
    readRejection.current = failure;
    setSnapshot(null);
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
      mounted.current = false;
      generation.current++;
      window.removeEventListener('auth-expired', expire);
    };
  }, [client, scope]);
  const query = useQuery<AuditResponse>({
    queryKey: [...scope, serialized, page],
    queryFn: async ({ signal }) => {
      const issued = generation.current;
      try {
        const data = await api<AuditResponse>(
          `/admin/audit?${queryString({ ...filters, page, pageSize: 20 })}`,
          { signal },
        );
        if (!isCurrent() || signal.aborted || issued !== generation.current)
          throw new DOMException('审计请求已失效', 'AbortError');
        readRejection.current = null;
        return data;
      } catch (failure) {
        if (readRejected(failure) && isCurrent() && issued === generation.current) rejectCached(failure);
        throw failure;
      }
    },
    retry: false,
    structuralSharing: false,
    staleTime: 0,
    refetchInterval: 60000,
  });
  const priorRejection = query.data ? rejectedSnapshots.get(query.data) : undefined;
  const blocked = !!priorRejection || (!query.data && !!readRejection.current);
  const readError = priorRejection ?? (blocked ? readRejection.current : query.error);
  const data = blocked || readRejected(readError) ? undefined : query.data;
  useEffect(() => {
    if (data) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, page]);
  function apply() {
    try {
      setFilters(parseAuditDraft(draft));
      setPage(1);
      setFilterError('');
    } catch (failure) {
      setFilterError(failure instanceof Error ? failure.message : '请核对审计筛选。');
    }
  }
  const exportCurrent = () =>
    isCurrent() &&
    canExport &&
    !!client.getQueryData<{ user: User }>(['auth'])?.user.permissions.includes('data.export') &&
    !readRejection.current;
  if (expired || !isCurrent()) return null;
  return (
    <section className="audit-panel" aria-labelledby={`${identifier}-title`}>
      <h2 id={`${identifier}-title`}>机构操作审计</h2>
      <form
        className="audit-filters"
        aria-label="审计组合筛选"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        {(['search', 'action', 'actorId', 'resourceType', 'resourceId', 'requestId'] as const).map((key) => (
          <label key={key}>
            <span>{auditFilterLabels[key]}</span>
            <Input
              aria-label={auditFilterLabels[key]}
              value={draft[key]}
              maxLength={
                {
                  search: 200,
                  action: 200,
                  actorId: 128,
                  resourceType: 100,
                  resourceId: 256,
                  requestId: 200,
                }[key]
              }
              disabled={snapshot !== null}
              allowClear
              placeholder={
                key === 'search'
                  ? '操作、资源或追踪 ID'
                  : key === 'actorId'
                    ? '支持历史账号的原始 ID'
                    : undefined
              }
              onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
            />
          </label>
        ))}
        {(['from', 'to'] as const).map((key) => (
          <label key={key}>
            <span>{auditFilterLabels[key]}</span>
            <Input
              type="datetime-local"
              step="1"
              aria-label={auditFilterLabels[key]}
              value={draft[key]}
              disabled={snapshot !== null}
              onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
            />
          </label>
        ))}
        <p className="audit-time-hint">
          时间按北京时间解释，精确到秒，起止瞬间均包含。结束时间不会自动扩展至当日末尾。
          综合关键词在操作、资源和追踪 ID 中匹配，不检索详情正文。其余筛选同时满足。
        </p>
        <div className="audit-filter-actions">
          <Button type="primary" htmlType="submit" disabled={snapshot !== null}>
            应用审计筛选
          </Button>
          <Button
            disabled={snapshot !== null}
            onClick={() => {
              setDraft(blankDraft());
              setFilters({});
              setPage(1);
              setFilterError('');
            }}
          >
            重置审计筛选
          </Button>
          <Button
            icon={<RefreshCw size={15} aria-hidden="true" />}
            disabled={query.isFetching || snapshot !== null}
            onClick={() => void query.refetch()}
          >
            刷新审计日志
          </Button>
          {canExport ? (
            <Button
              icon={<Download size={15} aria-hidden="true" />}
              disabled={!data || query.isFetching || query.isError || !exportCurrent()}
              onClick={() =>
                data && exportCurrent() && setSnapshot({ filters: { ...filters }, total: data.total })
              }
            >
              导出审计 CSV
            </Button>
          ) : (
            <span className="audit-export-hint">CSV 导出需要独立限时导出授权。</span>
          )}
        </div>
      </form>
      {filterError && <Alert type="error" showIcon message="审计筛选未应用" description={filterError} />}
      <div className="audit-applied" aria-label="已应用的审计筛选">
        <strong>已应用：</strong>
        {Object.entries(filters).length
          ? Object.entries(filters).map(([key, value]) => (
              <Tag key={key}>
                {auditFilterLabels[key as keyof AuditFilters]}：
                {key === 'from' || key === 'to' ? auditTimestamp(value!) : value}
              </Tag>
            ))
          : '当前机构全部审计'}
      </div>
      {(query.isLoading || (blocked && query.isFetching)) && (
        <p role="status" aria-label="审计加载状态">
          <Spin size="small" /> 正在加载审计日志…
        </p>
      )}
      {readError && (
        <Alert
          type="error"
          showIcon
          message={
            readRejected(readError)
              ? readError.status === 403
                ? '无权查看审计日志，请确认当前权限'
                : readError.status === 401
                  ? '当前登录已失效'
                  : '审计请求被拒绝，请核对筛选'
              : data
                ? '暂时无法刷新，正在显示上次加载的审计快照'
                : '暂时无法加载审计日志'
          }
          description={readError instanceof Error ? readError.message : undefined}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试加载审计
            </Button>
          }
        />
      )}
      {data && (
        <>
          <p role="status" aria-label="审计匹配数量">
            匹配 {data.total} 条审计记录 · 第 {data.page} 页{query.isFetching ? ' · 正在刷新' : ''}
          </p>
          <div className="audit-table">
            <Table
              rowKey="id"
              dataSource={data.items}
              onRow={(record) =>
                ({ 'data-testid': `audit-row-${record.id}` }) as React.HTMLAttributes<HTMLTableRowElement>
              }
              scroll={{ x: 1050 }}
              size="middle"
              expandable={{
                expandedRowRender: (record) => (
                  <pre className="audit-detail">{JSON.stringify(record.details ?? {}, null, 2)}</pre>
                ),
              }}
              columns={[
                {
                  title: '时间（北京时间）',
                  dataIndex: 'createdAt',
                  render: (value: string) => auditTimestamp(value),
                  width: 190,
                },
                {
                  title: '操作人',
                  render: (_, record) => (
                    <div>
                      {record.actorName}
                      <br />
                      <small>{record.userId ?? '系统'}</small>
                    </div>
                  ),
                  width: 180,
                },
                {
                  title: '操作',
                  dataIndex: 'action',
                  render: (value: string) => <Tag>{value}</Tag>,
                  width: 180,
                },
                {
                  title: '资源类型',
                  dataIndex: 'resourceType',
                  render: (value: string | null) => value ?? '—',
                  width: 125,
                },
                {
                  title: '资源标识',
                  dataIndex: 'resourceId',
                  render: (value: string | null) => value ?? '—',
                  width: 180,
                },
                {
                  title: '追踪 ID',
                  dataIndex: 'requestId',
                  render: (value: string | null) => value ?? '—',
                  width: 180,
                },
              ]}
              pagination={{
                current: page,
                pageSize: 20,
                total: data.total,
                showSizeChanger: false,
                onChange: (value) => {
                  setPage(value);
                  setFilterError('');
                },
              }}
            />
          </div>
        </>
      )}
      {snapshot && (
        <AuditExport
          snapshot={snapshot}
          csrf={csrf}
          isCurrent={exportCurrent}
          onClose={() => setSnapshot(null)}
        />
      )}
    </section>
  );
}

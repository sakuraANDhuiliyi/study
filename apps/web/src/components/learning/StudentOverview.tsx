import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Spin } from 'antd';
import { ApiError, getCsrf, type User } from '../../api';

export type DashboardData = {
  metrics: { label: string; value: number | null; detail?: string; path?: string }[];
  courses: any[];
  tasks: any[];
  announcements: any[];
  activity: any[];
  weeklyActivity?: { date: string; count: number }[];
  // Metadata is optional until the backend contract is finalized. Card values
  // always come from the existing metrics array, never the seven-day buckets.
  learningOverview?: { serverTime?: string; timezone?: string; scope?: string };
};
export type StudentOverviewIdentity = { owner: string; authorization: string; csrf: string };
export const overviewOwner = (user?: User) => JSON.stringify([user?.organizationId, user?.id, user?.role]);
export const overviewAuthorization = (user?: User) =>
  JSON.stringify([
    user?.organizationId,
    user?.id,
    user?.role,
    user?.accountMode,
    [...(user?.roles ?? [])].sort(),
    [...(user?.permissions ?? [])].sort(),
  ]);
const deniedSnapshots = new WeakMap<DashboardData, ApiError>();
const rejected = (failure: unknown): failure is ApiError =>
  failure instanceof ApiError && failure.status >= 400 && failure.status < 500;

/** Only the organization student's dashboard read, with no global auth-helper changes. */
export function useStudentOverview(identity: StudentOverviewIdentity, enabled: boolean) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const expiredRef = useRef(false);
  const [expired, setExpired] = useState(false);
  const generation = useRef(0);
  const denial = useRef<ApiError | null>(null);
  const { owner, authorization, csrf } = identity;
  const scope = useMemo(
    () => ['/dashboard/student-overview', owner, authorization, csrf] as const,
    [owner, authorization, csrf],
  );
  function current() {
    const user = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expiredRef.current &&
      !!user &&
      user.role === 'STUDENT' &&
      user.accountMode !== 'PERSONAL' &&
      overviewOwner(user) === owner &&
      overviewAuthorization(user) === authorization &&
      getCsrf() === csrf &&
      user.permissions.includes('course.read') &&
      user.permissions.includes('learning.use')
    );
  }
  function rejectCached(failure: ApiError) {
    generation.current++;
    for (const [, snapshot] of client.getQueriesData<DashboardData>({ queryKey: scope }))
      if (snapshot) deniedSnapshots.set(snapshot, failure);
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
      if (!current()) {
        const changed = new ApiError(409, '概览访问范围已变化，请重新载入。');
        for (const [, snapshot] of client.getQueriesData<DashboardData>({ queryKey: scope }))
          if (snapshot) deniedSnapshots.set(snapshot, changed);
      }
      mounted.current = false;
      generation.current++;
      window.removeEventListener('auth-expired', expire);
    };
  }, [client, scope]);
  const query = useQuery<DashboardData>({
    queryKey: scope,
    enabled,
    queryFn: async ({ signal }) => {
      const issued = generation.current;
      const active = () => current() && !signal.aborted && issued === generation.current;
      try {
        // A local JSON fetch checks the complete auth signature before 401 expiry.
        // The shared api() 401 guard only compares owner/CSRF; a permission-only
        // change under the same session must also fence this private read.
        const response = await fetch('/api/dashboard', { credentials: 'include', signal });
        if (!active()) throw new DOMException('学习概览请求已失效', 'AbortError');
        const body = await response.json().catch(() => ({}));
        if (!active()) throw new DOMException('学习概览请求已失效', 'AbortError');
        if (!response.ok) {
          const description = body.message || body.error?.message;
          const error = new ApiError(
            response.status,
            Array.isArray(description)
              ? description.join('；').slice(0, 600)
              : typeof description === 'string'
                ? description.slice(0, 600)
                : '暂时无法加载学习概览',
            body.error?.requestId || body.requestId,
          );
          if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
          throw error;
        }
        denial.current = null;
        return body as DashboardData;
      } catch (failure) {
        if (rejected(failure) && active()) rejectCached(failure);
        throw failure;
      }
    },
    retry: false,
    staleTime: 0,
    structuralSharing: false,
    refetchInterval: 60000,
  });
  const priorDenial = query.data ? deniedSnapshots.get(query.data) : undefined;
  const blocked = !!priorDenial || (!query.data && !!denial.current);
  const error = priorDenial ?? (blocked ? denial.current : query.error);
  return {
    ...query,
    data: !enabled || expired || !current() || blocked || rejected(error) ? undefined : query.data,
    error,
    isLoading: enabled && (query.isLoading || (blocked && query.isFetching)),
    expired,
  };
}

export function StudentOverviewState({
  query,
  children,
}: {
  query: ReturnType<typeof useStudentOverview>;
  children: ReactNode;
}) {
  const error = query.error;
  const denied = rejected(error);
  const stamp = query.data?.learningOverview?.serverTime;
  const date =
    typeof stamp === 'string' && Number.isFinite(Date.parse(stamp))
      ? new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(stamp))
      : null;
  return (
    <section className="lms-dash-student-overview" aria-label="学生学习概览">
      <div className="lms-dash-overview-heading">
        <h2>学习概览</h2>
        <Button
          size="small"
          aria-label="刷新学习概览"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新
        </Button>
      </div>
      {date && (
        <p className="lms-dash-overview-stamp" role="status" aria-label="概览统计时间">
          截至服务器北京时间 {date}；实际提交与作答以进入时的个人安排为准。
        </p>
      )}
      {query.isLoading && (
        <p role="status" aria-label="学习概览加载状态">
          <Spin size="small" /> 正在加载学习概览…
        </p>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={
            denied
              ? error.status === 401
                ? '当前登录已失效'
                : '无权查看学习概览，请确认当前权限'
              : query.data
                ? '暂时无法刷新，正在显示上次载入的学习概览'
                : '暂时无法加载学习概览'
          }
          description={error instanceof Error ? error.message : undefined}
          action={
            <Button size="small" aria-label="重试加载学习概览" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {query.data && children}
    </section>
  );
}

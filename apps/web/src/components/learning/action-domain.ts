import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, getCsrf, type User } from '../../api';
import { useAuth } from '../../auth';

export type LearningFilters = { type: 'all' | 'personal' | 'assignment' | 'exam'; courseId?: string };
export const learningOwner = (user?: User) => JSON.stringify([user?.organizationId, user?.id, user?.role]);
export const learningAuthorization = (user?: User) =>
  JSON.stringify([
    user?.organizationId,
    user?.id,
    user?.role,
    user?.accountMode,
    [...(user?.roles ?? [])].sort(),
    [...(user?.permissions ?? [])].sort(),
  ]);
const rejectedSnapshots = new WeakMap<object, ApiError>();
const denied = (failure: unknown): failure is ApiError =>
  failure instanceof ApiError && failure.status >= 400 && failure.status < 500;

/** One ActionPanel domain only, including its lightweight course picker. */
export function useLearningActionDomain() {
  const { user } = useAuth();
  const client = useQueryClient();
  const owner = learningOwner(user),
    authorization = learningAuthorization(user),
    csrf = getCsrf();
  const scope = useMemo(
    () => ['/planner/actions', owner, authorization, csrf] as const,
    [owner, authorization, csrf],
  );
  const mounted = useRef(true),
    expiredRef = useRef(false),
    generation = useRef(0),
    rejection = useRef<ApiError | null>(null);
  const [revision, setRevision] = useState(0);
  function isCurrent() {
    const current = client.getQueryData<{ user: User }>(['auth'])?.user;
    return (
      mounted.current &&
      !expiredRef.current &&
      !!current &&
      current.role === 'STUDENT' &&
      learningOwner(current) === owner &&
      learningAuthorization(current) === authorization &&
      getCsrf() === csrf &&
      current.permissions.includes('learning.use')
    );
  }
  function mark(failure: ApiError) {
    generation.current++;
    for (const [, data] of client.getQueriesData<object>({ queryKey: scope }))
      if (data) rejectedSnapshots.set(data, failure);
    rejection.current = failure;
    setRevision((value) => value + 1);
    void client.invalidateQueries({ queryKey: scope, refetchType: 'none' });
  }
  useEffect(() => {
    mounted.current = true;
    const expire = () => {
      mark(new ApiError(401, '当前登录已失效'));
      expiredRef.current = true;
      void client.cancelQueries({ queryKey: scope });
    };
    window.addEventListener('auth-expired', expire);
    return () => {
      if (!isCurrent()) {
        const failure = new ApiError(409, '学习行动访问范围已变化，请重新载入。');
        for (const [, data] of client.getQueriesData<object>({ queryKey: scope }))
          if (data) rejectedSnapshots.set(data, failure);
      }
      mounted.current = false;
      generation.current++;
      window.removeEventListener('auth-expired', expire);
    };
  }, [client, scope]);
  async function request<T>(
    path: string,
    init: RequestInit = {},
    requiresCourse = false,
    validate?: (body: T) => void,
  ): Promise<T> {
    const issued = generation.current;
    const active = () => isCurrent() && !init.signal?.aborted && issued === generation.current;
    const read = !init.method || init.method === 'GET';
    try {
      if (!active()) throw new DOMException('学习行动请求已失效', 'AbortError');
      if (
        requiresCourse &&
        !client.getQueryData<{ user: User }>(['auth'])?.user.permissions.includes('course.read')
      )
        throw new ApiError(403, '当前没有课程查看权限');
      const headers = new Headers(init.headers);
      if (init.body) headers.set('Content-Type', 'application/json');
      if (!read) headers.set('x-csrf-token', csrf);
      const response = await fetch('/api' + path, { ...init, headers, credentials: 'include' });
      if (!active()) throw new DOMException('学习行动请求已失效', 'AbortError');
      const body = await response.json().catch(() => ({}));
      if (!active()) throw new DOMException('学习行动请求已失效', 'AbortError');
      if (!response.ok) {
        const text = body.message || body.error?.message;
        const failure = new ApiError(
          response.status,
          Array.isArray(text)
            ? text.join('；').slice(0, 600)
            : typeof text === 'string'
              ? text.slice(0, 600)
              : '学习行动请求失败',
          body.error?.requestId || body.requestId,
        );
        if (response.status === 401) window.dispatchEvent(new Event('auth-expired'));
        throw failure;
      }
      validate?.(body as T);
      if (read) rejection.current = null;
      return body as T;
    } catch (failure) {
      // CAS mutation errors retain their existing 409/404/403 handling. Only a
      // denied private GET revokes all Action/picker snapshots in this scope.
      if (read && denied(failure) && active()) mark(failure);
      throw failure;
    }
  }
  function expose<T extends object>(query: {
    data?: T;
    error: Error | null;
    isLoading: boolean;
    isFetching: boolean;
  }) {
    const prior = query.data ? rejectedSnapshots.get(query.data) : undefined;
    const blocked = !!prior || (!query.data && !!rejection.current);
    const error = prior ?? (blocked ? rejection.current : query.error);
    return {
      data: !isCurrent() || blocked || denied(error) ? undefined : query.data,
      error,
      isLoading: query.isLoading || (blocked && query.isFetching),
    };
  }
  return {
    scope,
    isCurrent,
    generation,
    request,
    expose,
    trusted: (snapshot?: object) => !!snapshot && isCurrent() && !rejectedSnapshots.has(snapshot),
    expired: expiredRef.current,
    revision,
  };
}
export type LearningActionDomain = ReturnType<typeof useLearningActionDomain>;
